import { sql } from "drizzle-orm"
import { createNodeDb } from "@slipstream/db/node"
const db = createNodeDb(process.env.DATABASE_URL!)
const r = await db.execute(sql`select venue, count(*)::int n, count(*) filter (where copyable)::int copyable, max(refreshed_at) latest from trader_profiles where refreshed_at > now() - interval '1 hour' group by venue`)
console.log((r as unknown as { rows: unknown[] }).rows); process.exit(0)
