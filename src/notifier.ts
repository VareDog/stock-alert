import { EmailMessage } from "cloudflare:email"

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  EMAIL: { send(message: EmailMessage): Promise<void> }
  ALERT_KEY: string
  WXPUSHER_TOKEN: string
  WXPUSHER_UID: string
  WECOM_CORPID: string
  WECOM_SECRET: string
  WECOM_AGENTID: string
  MAIL_TO: string
  MAIL_FROM: string
  RESEND_API_KEY: string
  RESEND_TO: string
  RESEND_FROM: string
}

export interface Row {
  id: number
  code: string
  name: string
  buy_price: number
  sell_price: number
  band: number
  enabled_buy: number
  enabled_sell: number
  channel: string
  triggered: number
  last_sent_at: number
  sent_today: number
  sent_date: string
}

export interface Quote {
  name: string
  price: number
  change_pct: number
}

const WXPUSHER_API = "https://wxpusher.zjiecode.com/api/send/message"
const RESEND_API = "https://api.resend.com/emails"
const WECOM_TOKEN_API = "https://qyapi.weixin.qq.com/cgi-bin/gettoken"
const WECOM_SEND_API = "https://qyapi.weixin.qq.com/cgi-bin/message/send"

// 企业微信 access_token 缓存（7200 秒有效）
let wecomToken: { token: string; at: number } | null = null

async function getWecomToken(env: Env): Promise<string | null> {
  if (!env.WECOM_CORPID || !env.WECOM_SECRET) return null
  if (wecomToken && Date.now() - wecomToken.at < 7000 * 1000) return wecomToken.token
  const res = await fetch(
    `${WECOM_TOKEN_API}?corpid=${env.WECOM_CORPID}&corpsecret=${env.WECOM_SECRET}`
  )
  const data = (await res.json().catch(() => null)) as { access_token?: string } | null
  if (!data?.access_token) return null
  wecomToken = { token: data.access_token, at: Date.now() }
  return wecomToken.token
}

async function wecomPost(env: Env, token: string, content: string) {
  return fetch(`${WECOM_SEND_API}?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      touser: "@all",
      msgtype: "text",
      agentid: Number(env.WECOM_AGENTID),
      text: { content },
    }),
  })
}

// 企业微信应用消息（个人微信扫码关注微信插件后秒达）
export async function sendWecom(
  env: Env,
  content: string
): Promise<{ ok: boolean; data: unknown }> {
  const token = await getWecomToken(env)
  if (!token) return { ok: false, data: "未配置企业微信" }
  let res = await wecomPost(env, token, content)
  let data = (await res.json().catch(() => null)) as { errcode?: number; errmsg?: string } | null
  // token 过期则刷新重试一次
  if (data?.errcode === 40014 || data?.errcode === 42001) {
    wecomToken = null
    const t2 = await getWecomToken(env)
    if (!t2) return { ok: false, data: "token 刷新失败" }
    res = await wecomPost(env, t2, content)
    data = (await res.json().catch(() => null)) as { errcode?: number } | null
  }
  return { ok: data?.errcode === 0, data }
}

function utf8B64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

// 主邮件通道：Cloudflare Email Routing（Worker send_email binding）
export async function sendCfEmail(env: Env, subject: string, content: string): Promise<void> {
  const to = env.MAIL_TO
  const from = env.MAIL_FROM || "noreply@snn.de5.net"
  const raw = [
    `From: Stock Alert <${from}>`,
    `To: <${to}>`,
    `Subject: =?UTF-8?B?${utf8B64(subject)}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    utf8B64(content),
  ].join("\r\n")
  await env.EMAIL.send(new EmailMessage(from, to, raw))
}

// 微信通道：优先企业微信（秒达），未配置或失败时回落 WxPusher
export async function sendWx(env: Env, content: string): Promise<{ ok: boolean; data: unknown }> {
  if (env.WECOM_CORPID && env.WECOM_SECRET) {
    const r = await sendWecom(env, content)
    if (r.ok) return { ok: true, data: { via: "wecom", detail: r.data } }
  }
  if (!env.WXPUSHER_TOKEN || !env.WXPUSHER_UID) {
    return { ok: false, data: "企业微信和 WxPusher 均未配置或失败" }
  }
  const res = await fetch(WXPUSHER_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appToken: env.WXPUSHER_TOKEN,
      content,
      contentType: 1,
      uids: [env.WXPUSHER_UID],
    }),
  })
  const data = (await res.json().catch(() => null)) as { success?: boolean } | null
  return { ok: !!data?.success, data }
}

export async function sendEmail(env: Env, subject: string, content: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.RESEND_TO) return
  await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM || "onboarding@resend.dev",
      to: env.RESEND_TO,
      subject,
      text: content,
    }),
  })
}

export async function notify(
  env: Env,
  channel: string,
  title: string,
  content: string
): Promise<void> {
  const tasks: Promise<void>[] = []
  if (channel === "wx" || channel === "both")
    tasks.push(sendWx(env, content).then(() => undefined))
  if (channel === "email" || channel === "both") tasks.push(sendMail(env, title, content))
  await Promise.allSettled(tasks)
}

// 邮件通道：CF Email Routing 为主，Resend 备用
async function sendMail(env: Env, subject: string, content: string): Promise<void> {
  if (env.MAIL_TO) {
    try {
      await sendCfEmail(env, subject, content)
      return
    } catch (e) {
      console.error("cf email failed", e)
    }
  }
  await sendEmail(env, subject, content)
}
