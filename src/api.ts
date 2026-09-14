import type { Env, Quote } from "./notifier"
import { sendCfEmail, sendEmail, sendWx } from "./notifier"
import { fetchQuotes, hitBuy, hitSell } from "./checker"

export async function handleApi(
  req: Request,
  env: Env,
  path: string
): Promise<Response> {
  const url = new URL(req.url)
  const db = env.DB
  const method = req.method

  // 通道测试：GET /api/test-wx?key=口令 / GET /api/test-mail?key=口令（浏览器可直接访问）
  if (path === "/api/test-wx" && method === "GET") {
    if (url.searchParams.get("key") !== env.ALERT_KEY) return json({ error: "口令错误" }, 401)
    const r = await sendWx(env, `测试推送 Stock Alert\n时间：${new Date().toISOString()}`)
    return json(r)
  }
  if (path === "/api/test-mail" && method === "GET") {
    if (url.searchParams.get("key") !== env.ALERT_KEY) return json({ error: "口令错误" }, 401)
    const subject = `测试邮件 Stock Alert ${new Date().toISOString()}`
    const content = "这是一封测试邮件，收到说明 CF 邮件通道正常。"
    try {
      await sendCfEmail(env, subject, content)
      return json({ ok: true, via: "cf-email" })
    } catch (e) {
      const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      try {
        await sendEmail(env, subject, content)
        return json({ ok: true, via: "resend", cfError: err })
      } catch (e2) {
        const err2 = e2 instanceof Error ? `${e2.name}: ${e2.message}` : String(e2)
        return json({ ok: false, cfError: err, resendError: err2 })
      }
    }
  }

  const key = req.headers.get("X-Alert-Key") ?? ""
  if (!env.ALERT_KEY || key !== env.ALERT_KEY) {
    return json({ error: "口令错误" }, 401)
  }

  // 单支行情查询：POST /api/quote {"code":"sh600000"}
  if (path === "/api/quote" && method === "POST") {
    const body = (await req.json()) as { code?: string }
    const code = (body.code ?? "").trim().toLowerCase()
    if (!/^s[hzb]\d{6}$/.test(code)) return json({ error: "代码格式：sh600000 / sz000001 / bj430047" }, 400)
    const quotes = await fetchQuotes([code])
    const q = quotes.get(code)
    if (!q) return json({ error: "查不到该代码的行情" }, 404)
    return json({ name: q.name, price: q.price })
  }

  // 全部行
  if (path === "/api/rows" && method === "GET") {
    const { results } = await db.prepare("SELECT * FROM rows ORDER BY id ASC").all()
    return json({ rows: results })
  }

  // 页面实时刷新：批量现价 + 实时判断命中
  if (path === "/api/refresh" && method === "GET") {
    const { results } = await db.prepare("SELECT * FROM rows").all()
    const allRows = (results ?? []) as unknown as RowLike[]
    const codes = [...new Set(allRows.map((r) => r.code.toLowerCase()))]
    const quotes = await fetchQuotes(codes)
    const out: Record<string, { name: string; price: number; hit: boolean }> = {}
    for (const r of allRows) {
      const q = quotes.get(r.code.toLowerCase())
      if (!q) continue
      const hit = hitBuy(r, q.price) || hitSell(r, q.price)
      out[r.code.toLowerCase()] = { name: q.name, price: q.price, hit }
    }
    return json({ quotes: out })
  }

  // 新增行
  if (path === "/api/rows" && method === "POST") {
    const body = (await req.json()) as { code?: string }
    const code = (body.code ?? "").trim().toLowerCase()
    if (!/^s[hzb]\d{6}$/.test(code)) return json({ error: "代码格式：sh600000 / sz000001 / bj430047" }, 400)
    const quotes = await fetchQuotes([code])
    const q: Quote | undefined = quotes.get(code)
    const result = await db
      .prepare("INSERT INTO rows (code, name, created_at) VALUES (?1, ?2, ?3)")
      .bind(code, q?.name ?? "", Date.now())
      .run()
    const row = await db
      .prepare("SELECT * FROM rows WHERE id = ?1")
      .bind(result.meta.last_row_id)
      .first()
    return json({ row })
  }

  // 更新行
  const updateMatch = path.match(/^\/api\/rows\/(\d+)$/)
  if (updateMatch && method === "PUT") {
    const id = parseInt(updateMatch[1], 10)
    const body = (await req.json()) as Record<string, unknown>
    const existing = await db
      .prepare("SELECT * FROM rows WHERE id = ?1")
      .bind(id)
      .first<RowLike>()
    if (!existing) return json({ error: "行不存在" }, 404)

    let name = existing.name
    const codeChanged = typeof body.code === "string" && body.code.trim().toLowerCase() !== existing.code
    const code = codeChanged ? (body.code as string).trim().toLowerCase() : (existing.code as string)
    if (codeChanged) {
      if (!/^s[hzb]\d{6}$/.test(code)) return json({ error: "代码格式：sh600000 / sz000001 / bj430047" }, 400)
      const quotes = await fetchQuotes([code])
      name = quotes.get(code)?.name ?? ""
    }

    await db
      .prepare(
        `UPDATE rows SET code = ?1, name = ?2,
         buy_price = ?3, sell_price = ?4, band = ?5,
         enabled_buy = ?6, enabled_sell = ?7, channel = ?8
         WHERE id = ?9`
      )
      .bind(
        code,
        name,
        num(body.buy_price, existing.buy_price),
        num(body.sell_price, existing.sell_price),
        num(body.band, existing.band),
        body.enabled_buy !== undefined ? (body.enabled_buy ? 1 : 0) : existing.enabled_buy,
        body.enabled_sell !== undefined ? (body.enabled_sell ? 1 : 0) : existing.enabled_sell,
        typeof body.channel === "string" ? body.channel : existing.channel,
        id
      )
      .run()
    const row = await db
      .prepare("SELECT * FROM rows WHERE id = ?1")
      .bind(id)
      .first()
    return json({ row })
  }

  // 删除行
  if (updateMatch && method === "DELETE") {
    const id = parseInt(updateMatch[1], 10)
    await db.prepare("DELETE FROM rows WHERE id = ?1").bind(id).run()
    return json({ ok: true })
  }

  return json({ error: "not found" }, 404)
}

interface RowLike {
  code: string
  name: string
  buy_price: number
  sell_price: number
  band: number
  enabled_buy: number
  enabled_sell: number
  channel: string
}

function num(value: unknown, fallback: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""))
  return Number.isFinite(n) ? n : (fallback as number)
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}
