// E2E: pretend the leader just traded one of their markets at the current mid,
// then run one Hyperliquid cycle. Exercises gates -> paper fill -> ledger.
import { asMarketId, asTimestamp, money } from "@slipstream/shared"
import type { Address } from "@slipstream/shared"
import { createNodeDb } from "@slipstream/db/node"
import { createLogger } from "@slipstream/shared/log/index.js"
import { CopyEngine } from "../apps/engine/src/copy/cycle.js"
import { hl, hlLastFill, hlSnapshot } from "../apps/engine/src/copy/venues.js"
const LEADER = "0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00"
await hl.warmUp()
const snap = await hlSnapshot(LEADER)
const pick = snap.positions.sort((a, b) => money.cmp(money.abs(b.notional), money.abs(a.notional)))[0]!
const book = await hl.getBook(pick.marketId, 5)
const mid = money.div(money.add(book.bids[0]!.price, book.asks[0]!.price), money.fromInt(2), 8, "trunc")
hlLastFill.set(LEADER, new Map([[pick.marketId, { leaderAddress: LEADER as Address, leaderFillPrice: mid, leaderFillTs: asTimestamp(Date.now()) }]]))
console.log(`injected fresh fill: ${pick.marketId} ${pick.side} leader size ${money.format(pick.size)} @ mid ${money.format(mid)}`)
const eng = new CopyEngine(createNodeDb(process.env.DATABASE_URL!), createLogger({ level: "warn" }))
await eng.runCycle("hyperliquid")
console.log("cycle", eng.lastCycle)
process.exit(0)
