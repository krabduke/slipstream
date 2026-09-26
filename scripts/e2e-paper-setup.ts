// E2E: a throwaway test user with one paper follow per venue. Delete with --cleanup.
import { eq } from "drizzle-orm"
import { createNodeDb } from "@slipstream/db/node"
import { schema } from "@slipstream/db"
import { createPaperFollow, upsertUserByAddress } from "@slipstream/db/queries/index"
import type { UserId } from "@slipstream/shared"
const TEST = "0x7e57000000000000000000000000000000e2e001"
const db = createNodeDb(process.env.DATABASE_URL!)
if (process.argv.includes("--cleanup")) {
  await db.delete(schema.users).where(eq(schema.users.address, TEST))
  console.log("test user and everything under it deleted")
  process.exit(0)
}
const u = await upsertUserByAddress(db, TEST)
const hl = await createPaperFollow(u.id as UserId, db, { venue: "hyperliquid", leaderAddress: "0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00", leaderLabel: null, sizingMode: "equity_ratio", sizingParam: "1", startingEquity: "10000" })
const pm = await createPaperFollow(u.id as UserId, db, { venue: "polymarket", leaderAddress: "0x8c0b024c17831a0dde038547b7e791ae6a0d7aa5", leaderLabel: "THEHIGHLIFE", sizingMode: "fixed_notional", sizingParam: "100", startingEquity: "10000" })
console.log({ user: u.id, hl: hl.id, pm: pm.id })
process.exit(0)
