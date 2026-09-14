import type { Env, Quote, Row } from "./notifier"
import { notify } from "./notifier"

const TENCENT_API = "https://qt.gtimg.cn/q="
const LIMIT_PER_HOUR = 3600 * 1000
const LIMIT_PER_DAY = 5

// 北京时间偏移（UTC+8）
const CN_TZ = 8 * 3600 * 1000

function beijingParts(now: number): { hhmm: number; date: string } {
  const d = new Date(now + CN_TZ)
  const hh = d.getUTCHours()
  const mm = d.getUTCMinutes()
  const hhmm = hh * 100 + mm
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`
  return { hhmm, date }
}

// A股检查窗口：9:15-11:30、13:00-15:30，外加 11:31 与 15:31 两个收尾检查点
function inWindow(hhmm: number): boolean {
  if (hhmm === 1131 || hhmm === 1531) return true
  return (hhmm >= 915 && hhmm <= 1130) || (hhmm >= 1300 && hhmm <= 1530)
}

// 腾讯行情接口返回 GBK 编码，格式：v_sh600000="1~浦发银行~600000~10.50~...~"
// 字段索引：1=名称 3=现价 32=涨跌幅%
export async function fetchQuotes(codes: string[]): Promise<Map<string, Quote>> {
  const result = new Map<string, Quote>()
  if (codes.length === 0) return result
  const res = await fetch(TENCENT_API + codes.join(","), {
    headers: { Referer: "https://gu.qq.com/" },
  })
  const bytes = new Uint8Array(await res.arrayBuffer())
  const text = new TextDecoder("gbk").decode(bytes)
  const re = /v_(\w+)="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const parts = m[2].split("~")
    const price = parseFloat(parts[3])
    const changePct = parseFloat(parts[32])
    if (!Number.isNaN(price) && price > 0) {
      result.set(m[1].toLowerCase(), {
        name: parts[1],
        price,
        change_pct: Number.isNaN(changePct) ? 0 : changePct,
      })
    }
  }
  return result
}

// 代码规范化：支持纯数字自动补前缀（6→sh、0/3→sz、4/8→bj）
export function normalizeCode(raw: string): string | null {
  const code = raw.trim().toLowerCase()
  if (/^(sh|sz|bj)\d{6}$/.test(code)) return code
  if (/^\d{6}$/.test(code)) {
    const head = code[0]
    if (head === "6") return "sh" + code
    if (head === "0" || head === "3") return "sz" + code
    if (head === "4" || head === "8") return "bj" + code
  }
  return null
}

export type HitRow = Pick<
  Row,
  "enabled_buy" | "enabled_sell" | "buy_price" | "sell_price" | "band"
>

export function hitBuy(row: HitRow, price: number): boolean {
  if (!row.enabled_buy || !row.buy_price || row.buy_price <= 0) return false
  const band = row.band > 0 && row.band < 1 ? row.band : 0.1
  return price <= row.buy_price && price >= row.buy_price * (1 - band)
}

export function hitSell(row: HitRow, price: number): boolean {
  if (!row.enabled_sell || !row.sell_price || row.sell_price <= 0) return false
  const band = row.band > 0 && row.band < 1 ? row.band : 0.1
  return price >= row.sell_price * (1 - band) && price <= row.sell_price * (1 + band)
}

export async function runCheck(env: Env, now: number): Promise<void> {
  const { hhmm } = beijingParts(now)
  if (!inWindow(hhmm)) return

  // 随机闸门：每分钟触发但只在随机 3-10 分钟间隔时真正检查
  const stateRow = await env.DB.prepare("SELECT value FROM state WHERE key = 'next_check_at'")
    .first<{ value: string }>()
  const nextCheck = stateRow ? parseInt(stateRow.value, 10) : 0
  if (now < nextCheck) return
  const nextInterval = (180 + Math.floor(Math.random() * 420)) * 1000
  await env.DB.prepare(
    "INSERT INTO state (key, value) VALUES ('next_check_at', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1"
  )
    .bind(String(now + nextInterval))
    .run()

  const { results: rows } = await env.DB.prepare(
    "SELECT * FROM rows WHERE enabled_buy = 1 OR enabled_sell = 1"
  ).all<Row>()
  if (!rows || rows.length === 0) return

  const codes = [...new Set(rows.map((r) => r.code.toLowerCase()))]
  const quotes = await fetchQuotes(codes)

  const today = beijingParts(now).date

  for (const row of rows) {
    const quote = quotes.get(row.code.toLowerCase())
    if (!quote) continue

    const buy = hitBuy(row, quote.price)
    const sell = hitSell(row, quote.price)
    const hit = buy || sell

    const sentToday = row.sent_date === today ? row.sent_today : 0
    const withinDayLimit = sentToday < LIMIT_PER_DAY
    const firstTime = hit && row.triggered === 0
    const steadyRepeat =
      hit && row.triggered === 1 && now - row.last_sent_at >= LIMIT_PER_HOUR
    const shouldSend = hit && withinDayLimit && (firstTime || steadyRepeat)

    if (shouldSend) {
      const parts: string[] = []
      if (buy) {
        parts.push(`【买入区间】${row.name}(${row.code}) 现价 ${quote.price}，意向买价 ${row.buy_price}`)
      }
      if (sell) {
        parts.push(`【卖出区间】${row.name}(${row.code}) 现价 ${quote.price}，意向卖价 ${row.sell_price}`)
      }
      parts.push(`时间：${today} ${Math.floor(hhmm / 100)}:${String(hhmm % 100).padStart(2, "0")}`)
      await notify(env, row.channel, `股票提醒：${row.name}`, parts.join("\n"))
    }

    await env.DB.prepare(
      `UPDATE rows SET triggered = ?1, current_price = ?2, name = ?3, sent_today = ?4, sent_date = ?5, last_sent_at = ?6 WHERE id = ?7`
    )
      .bind(
        hit ? 1 : 0,
        quote.price,
        quote.name,
        shouldSend ? sentToday + 1 : sentToday,
        today,
        shouldSend ? now : row.last_sent_at,
        row.id
      )
      .run()
  }
}
