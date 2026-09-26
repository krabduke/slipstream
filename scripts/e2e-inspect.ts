import { sql } from "drizzle-orm"
import { createNodeDb } from "@slipstream/db/node"
const db = createNodeDb(process.env.DATABASE_URL!)
const sub = process.argv[2]!
const r = await db.execute(sql`select verdict, reason_code, market_id, detail from decisions where subscription_id = ${sub} order by ts`)
const rows = (r as unknown as { rows: { verdict: string; reason_code: string | null; market_id: string; detail: Record<string, string> }[] }).rows
const tally: Record<string, number> = {}
for (const x of rows) tally[`${x.verdict}:${x.reason_code ?? "-"}`] = (tally[`${x.verdict}:${x.reason_code ?? "-"}`] ?? 0) + 1
console.log("decisions", rows.length, tally)
for (const x of rows.slice(0, 6)) console.log(" ", x.verdict, x.reason_code, x.market_id, JSON.stringify(x.detail).slice(0, 230))
const p = await db.execute(sql`select market_id, side, size, entry_price from paper_positions where subscription_id = ${sub}`)
console.log("paper positions", (p as unknown as { rows: unknown[] }).rows.slice(0, 5))
const b = await db.execute(sql`select starting_equity, realized_pnl, fees_paid, equity from paper_books where subscription_id = ${sub}`)
console.log("book", (b as unknown as { rows: unknown[] }).rows[0])
process.exit(0)
