import { describe, expect, it } from "vitest"
import { asMarketId, asTimestamp, money } from "@slipstream/shared"
import type { IdempotencyKey } from "@slipstream/shared"
import { buildCatalog } from "../read.js"
import { buildConstraints, type AssetSpec } from "../quantize.js"
import { marketablePrice, placeOrder, toCloid, toOrderResult, type HyperliquidExchange } from "../write.js"
import { META, SPOT_META } from "./fixtures.js"
import type { Book } from "../../types.js"

const BTC: AssetSpec = {
  marketId: asMarketId("BTC"),
  coin: "BTC",
  symbol: "BTC",
  kind: "perp",
  assetIndex: 3,
  szDecimals: 5,
  isDelisted: false,
  constraints: buildConstraints("perp", 5, 40),
}
const d = (s: string) => money.parse(s)
const book: Book = {
  marketId: BTC.marketId,
  asks: [{ price: d("64210"), size: d("2") }],
  bids: [{ price: d("64190"), size: d("2") }],
  ts: asTimestamp(0),
}

function fakeExchange(statuses: unknown[]) {
  const calls: Parameters<HyperliquidExchange["order"]>[0][] = []
  const ex: HyperliquidExchange = {
    order: async (p) => {
      calls.push(p)
      return { response: { data: { statuses: statuses as never } } }
    },
    cancel: async () => ({}),
  }
  return { ex, calls }
}

describe("catalog asset indices", () => {
  it("numbers perps by universe position and spot as 10000 + pair index", () => {
    const cat = buildCatalog(META, SPOT_META, asTimestamp(0))
    const perps = [...cat.specs.values()].filter((s) => s.kind === "perp")
    expect(perps.map((s) => s.assetIndex)).toEqual(perps.map((_, i) => i))
    for (const s of cat.specs.values()) if (s.kind === "spot") expect(s.assetIndex).toBeGreaterThanOrEqual(10_000)
  })
})

describe("marketablePrice", () => {
  it("crosses the book by the slippage and rounds toward the passive side", () => {
    // buy: 64210 x 1.005 = 64531.05 -> 5 significant figures, floored -> 64531
    expect(money.format(marketablePrice(BTC, "buy", book, 50)!)).toMatch(/^64531(\.0+)?$/)
    // sell: 64190 x 0.995 = 63869.05 -> ceil at 5 sig figs -> 63870
    expect(money.format(marketablePrice(BTC, "sell", book, 50)!)).toMatch(/^63870(\.0+)?$/)
    expect(marketablePrice(BTC, "buy", { ...book, asks: [] }, 50)).toBeNull()
  })
})

describe("toCloid", () => {
  it("reuses a 32-hex planner key and hashes anything else to the same shape", () => {
    expect(toCloid("a".repeat(32) as IdempotencyKey)).toBe(`0x${"a".repeat(32)}`)
    expect(toCloid("manual:123" as IdempotencyKey)).toMatch(/^0x[0-9a-f]{32}$/)
    expect(toCloid("manual:123" as IdempotencyKey)).toBe(toCloid("manual:123" as IdempotencyKey))
  })
})

describe("placeOrder", () => {
  it("sends a reduce-only IOC with the asset index, direction, quantized size and cloid", async () => {
    const { ex, calls } = fakeExchange([{ filled: { totalSz: "0.01", avgPx: "64215", oid: 77 } }])
    const res = await placeOrder(
      ex,
      BTC,
      {
        marketId: BTC.marketId,
        side: "sell",
        size: d("0.0100009"),
        kind: { type: "market", maxSlippageBps: 300 },
        reduceOnly: true,
        clientId: "b".repeat(32) as IdempotencyKey,
      },
      book,
    )
    const o = calls[0]!.orders[0]!
    expect([o.a, o.b, o.r, o.t.limit.tif, o.c]).toEqual([3, false, true, "Ioc", `0x${"b".repeat(32)}`])
    expect(o.s).toMatch(/^0\.01(0+)?$/) // 5 szDecimals, rounded down
    expect(res.status).toBe("filled")
    expect(res.venueOrderId).toBe("77")
  })

  it("refuses to send a size that rounds to zero", async () => {
    const { ex, calls } = fakeExchange([])
    const res = await placeOrder(ex, BTC, {
      marketId: BTC.marketId, side: "buy", size: d("0.000001"),
      kind: { type: "market", maxSlippageBps: 50 }, reduceOnly: false, clientId: "c".repeat(32) as IdempotencyKey,
    }, book)
    expect(calls).toHaveLength(0)
    expect(res.status).toBe("rejected")
  })
})

describe("toOrderResult", () => {
  it("maps partial fills, resting orders and venue errors", () => {
    expect(toOrderResult({ filled: { totalSz: "0.5", avgPx: "10", oid: 1 } }, d("1")).status).toBe("partial")
    expect(toOrderResult({ resting: { oid: 2 } }, d("1")).venueOrderId).toBe("2")
    const err = toOrderResult({ error: "Insufficient margin to place order." }, d("1"))
    expect([err.status, err.rejectReason]).toEqual(["rejected", "Insufficient margin to place order."])
  })
})
