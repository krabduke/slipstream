/** Temporary live verification harness for W7. Not a test — hits the real API.
 *  Run: pnpm exec tsx packages/venues/src/polymarket/__tests__/live-check.ts */
import { money, asAddress, asMarketId, asTimestamp } from "@slipstream/shared"
import { ClobClient, Chain } from "@polymarket/clob-client-v2"
import { createPolymarketRead } from "../read.js"

const f = (d: { mantissa: bigint; scale: number }) => money.format(d)
const YES = "27146956652877944551877724690365745048289675287536243265951843487691050802191"
const WALLET = asAddress("0x5e2b9261b0c4f697b55bf921ff2bc227183d9101")
const WHALE = asAddress("0xe40aaa5ce1dac0b7dc24c9d0284f27e17c3fe4a2")

const read = createPolymarketRead({ listMarkets: { minLiquidityUsd: 200_000, minVolumeUsd: 2_000_000 } })

console.log("== CLOB version (must be 2) ==")
const clob = new ClobClient({ host: "https://clob.polymarket.com", chain: Chain.POLYGON })
console.log("version:", await clob.getVersion())

console.log("\n== getBook ==")
const book = await read.getBook(asMarketId(YES), 6)
console.log("bids:", book.bids.map((l) => `${f(l.price)}x${f(l.size)}`).join(" "))
console.log("asks:", book.asks.map((l) => `${f(l.price)}x${f(l.size)}`).join(" "))
console.log("ts:", book.ts, new Date(book.ts).toISOString())
const bidsDescending = book.bids.every((l, i) => i === 0 || money.lte(l.price, book.bids[i - 1]!.price))
const asksAscending = book.asks.every((l, i) => i === 0 || money.gte(l.price, book.asks[i - 1]!.price))
console.log("bids best-first:", bidsDescending, "| asks best-first:", asksAscending)
console.log("spread:", f(money.sub(book.asks[0]!.price, book.bids[0]!.price)))

console.log("\n== constraints / quantize after the book taught it the tick ==")
const c = read.constraints(asMarketId(YES))
console.log("tick:", f(c.priceTick), "lot:", f(c.sizeLot), "maxLeverage:", f(c.maxLeverage), "short:", c.supportsShort)
const buy = read.quantize(asMarketId(YES), "buy", money.parse("0.0047"), money.parse("123.4567891"))
const sell = read.quantize(asMarketId(YES), "sell", money.parse("0.0047"), money.parse("123.4567891"))
console.log("buy  0.0047 ->", f(buy.price!), "size", f(buy.size), "belowMinimum", buy.belowMinimum)
console.log("sell 0.0047 ->", f(sell.price!), "size", f(sell.size), "belowMinimum", sell.belowMinimum)

console.log("\n== getPositions / getAccountValue (small wallet) ==")
const positions = await read.getPositions(WALLET)
const summed = positions.reduce((acc, p) => money.add(acc, p.notional), money.parse("0"))
const value = await read.getAccountValue(WALLET)
console.log("positions:", positions.length)
for (const p of positions.slice(0, 4)) {
  console.log(`  ${p.side} ${f(p.size)} @ ${f(p.entryPrice)} -> notional ${f(p.notional)} upnl ${f(p.unrealizedPnl)} lev=${String(p.leverage)}`)
}
console.log("sum(notional):", f(summed))
console.log("getAccountValue:", f(value))

console.log("\n== getPositions (large wallet, exercises paging) ==")
const many = await read.getPositions(WHALE)
const manySum = many.reduce((acc, p) => money.add(acc, p.notional), money.parse("0"))
console.log("positions:", many.length, "sum(notional):", f(manySum))
console.log("getAccountValue:", f(await read.getAccountValue(WHALE)))

console.log("\n== getFills (last 2h) ==")
const since = asTimestamp(Date.now() - 2 * 60 * 60 * 1000)
const fills = await read.getFills(WHALE, since)
console.log("fills:", fills.length, "all within window:", fills.every((x) => x.ts >= since))
for (const x of fills.slice(0, 3)) {
  console.log(`  ${new Date(x.ts).toISOString()} ${x.side} ${f(x.size)} @ ${f(x.price)} id=${x.id.slice(0, 26)}…`)
}
console.log("unique ids:", new Set(fills.map((x) => x.id)).size, "of", fills.length)

console.log("\n== listMarkets ==")
const t0 = Date.now()
const markets = await read.listMarkets()
const byStatus = markets.reduce<Record<string, number>>((acc, m) => {
  acc[m.status] = (acc[m.status] ?? 0) + 1
  return acc
}, {})
const ticks = markets.reduce<Record<string, number>>((acc, m) => {
  const k = f(m.constraints.priceTick)
  acc[k] = (acc[k] ?? 0) + 1
  return acc
}, {})
console.log("markets:", markets.length, "in", Date.now() - t0, "ms")
console.log("status:", byStatus)
console.log("ticks:", ticks)
console.log("sample:", markets[0]?.symbol, "| resolvesAt:", markets[0]?.resolvesAt)
const resolved = markets.find((m) => m.status === "resolved")
console.log("a resolved one:", resolved?.symbol, resolved?.id.slice(0, 12))

console.log("\n== watchBook (10s) ==")
let count = 0
const deadline = Date.now() + 10_000
for await (const delta of read.watchBook([asMarketId(YES)])) {
  count += 1
  if (count <= 3) {
    console.log(
      `  #${count} snapshot=${String(delta.isSnapshot)} bids=${delta.bids.length} asks=${delta.asks.length}` +
        ` best=${delta.bids[0] ? f(delta.bids[0].price) : "-"}/${delta.asks[0] ? f(delta.asks[0].price) : "-"}`,
    )
  }
  if (Date.now() > deadline) break
}
console.log("deltas received:", count)

console.log("\n== rateBudget ==")
console.log(await read.rateBudget(WHALE))
process.exit(0)
