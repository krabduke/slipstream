import { sql } from "drizzle-orm"
import { createNodeDb } from "@slipstream/db/node"
const db = createNodeDb(process.env.DATABASE_URL!)
await db.execute(sql`update subscriptions set sizing_mode = ${process.argv[3]!}, sizing_param = ${process.argv[4]!} where id = ${process.argv[2]!}`)
console.log("sizing updated"); process.exit(0)
