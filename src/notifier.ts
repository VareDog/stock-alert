export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  ALERT_KEY: string
  WXPUSHER_TOKEN: string
  WXPUSHER_UID: string
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
}

const WXPUSHER_API = "https://wxpusher.zjiecode.com/api/send/message"
const RESEND_API = "https://api.resend.com/emails"

export async function sendWx(env: Env, content: string): Promise<void> {
  if (!env.WXPUSHER_TOKEN || !env.WXPUSHER_UID) return
  await fetch(WXPUSHER_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appToken: env.WXPUSHER_TOKEN,
      content,
      contentType: 1,
      uids: [env.WXPUSHER_UID],
    }),
  })
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
  if (channel === "wx" || channel === "both") tasks.push(sendWx(env, content))
  if (channel === "email" || channel === "both") tasks.push(sendEmail(env, title, content))
  await Promise.allSettled(tasks)
}
