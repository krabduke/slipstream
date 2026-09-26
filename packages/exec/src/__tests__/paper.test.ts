import { describe, expect, it } from "vitest"
import { asMarketId, asTimestamp, money } from "@slipstream/shared"
import type { Book } from "@slipstream/venues"
import { applyFill, simulateFill } from "../paper.js"

const d = (s: string) => money.parse(s)
const n = (x: ReturnType<typeof d> | null) => (x === null ? null : Number(money.format(x)))
const book: Book = {
  marketId: asMarketId("BTC"),
  // deliberately unsorted: the executor must not trust venue ordering
  asks: [{ price: d("101"), size: d("2") }, { price: d("100"), size: d("1") }],
  bids: [{ price: d("98"), size: d("1") }, { price: d("99"), size: d("1") }],
  ts: asTimestamp(0),
}
const free = { latencyBps: 0, takerFeeBps: 0 }

describe("simulateFill", () => {
  it("walks the book best-first and averages across levels", () => {
    const f = simulateFill(book, "buy", d("2"), free)
    expect([n(f.filledSize), n(f.avgPrice)]).toEqual([2, 100.5]) // 1@100 + 1@101
  })

  it("fills only what the visible book holds", () => {
    const f = simulateFill(book, "sell", d("5"), free)
    expect([n(f.filledSize), n(f.avgPrice)]).toEqual([2, 98.5])
  })

  it("moves the price against the copier and charges the fee", () => {
    const f = simulateFill(book, "buy", d("1"), { latencyBps: 100, takerFeeBps: 10 })
    expect(n(f.avgPrice)).toBe(101) // 100 * 1.01
    expect(n(f.fee)).toBeCloseTo(0.101, 6) // 101 notional * 10 bps
  })

  it("returns an empty fill against an empty side", () => {
    expect(simulateFill({ ...book, asks: [] }, "buy", d("1"), free).avgPrice).toBeNull()
  })
})

describe("applyFill", () => {
  it("averages entries when adding and books PnL when reducing", () => {
    const a = applyFill(null, "buy", d("1"), d("100"))
    const b = applyFill(a.position, "buy", d("1"), d("110"))
    expect([n(b.position!.size), n(b.position!.entryPrice)]).toEqual([2, 105])
    const c = applyFill(b.position, "sell", d("1"), d("120"))
    expect([n(c.position!.size), n(c.realizedPnl)]).toEqual([1, 15])
  })

  it("closes and reverses through zero", () => {
    const r = applyFill({ side: "short", size: d("2"), entryPrice: d("50") }, "buy", d("3"), d("40"))
    expect([r.position!.side, n(r.position!.size), n(r.realizedPnl)]).toEqual(["long", 1, 20])
    const flat = applyFill({ side: "long", size: d("1"), entryPrice: d("10") }, "sell", d("1"), d("9"))
    expect([flat.position, n(flat.realizedPnl)]).toEqual([null, -1])
  })
})
