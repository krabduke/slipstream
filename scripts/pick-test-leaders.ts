import { createNodeDb } from "@slipstream/db/node"
import { listTraders, getTraderProfile, latestIntelRuns } from "@slipstream/db/queries/index"
const db = createNodeDb(process.env.DATABASE_URL!)
console.log((await latestIntelRuns(db)).map((r) => `${r.venue} profiled=${r.profiled} failed=${r.failed} at ${new Date(r.finished_at).toISOString()}`))
for (const venue of ["hyperliquid", "polymarket"]) {
  const rows = await listTraders(db, { venue, copyableOnly: true, sort: "score", limit: 15 })
  for (const r of rows) {
    const p = (await getTraderProfile(db, venue, r.address))!.profile as { openPositions: unknown[] }
    if (p.openPositions.length) { console.log(venue, r.address, r.displayName, "score", r.score, "open", p.openPositions.length); break }
  }
}
process.exit(0)
