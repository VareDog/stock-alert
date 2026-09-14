import { EmailMessage } from "cloudflare:email"

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  EMAIL: { send(message: EmailMessage): Promise<void> }
  ALERT_KEY: string
  WXPUSHER_TOKEN: string
  WXPUSHER_UID: string
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

export async function sendWx(env: Env, content: string): Promise<{ ok: boolean; data: unknown }> {
  if (!env.WXPUSHER_TOKEN || !env.WXPUSHER_UID) return { ok: false, data: "未配置 token/uid" }
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
