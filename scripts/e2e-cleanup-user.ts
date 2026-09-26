import { eq } from "drizzle-orm"
import { createNodeDb } from "@slipstream/db/node"
import { schema } from "@slipstream/db"
const db = createNodeDb(process.env.DATABASE_URL!)
const r = await db.delete(schema.users).where(eq(schema.users.address, process.argv[2]!.toLowerCase())).returning({ id: schema.users.id })
console.log("deleted users:", r.length); process.exit(0)
