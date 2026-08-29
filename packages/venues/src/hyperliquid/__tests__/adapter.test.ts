/**
 * W6 — the assembled adapter.
 *
 * The interesting behaviour here is the metadata cache. `constraints()` and
 * `quantize()` are synchronous by contract but need per-asset `szDecimals`, so
 * the catalogue has to be loaded ahead of them without the module import itself
 * reaching for the network.
 */
import { describe, expect, it } from "vitest"
import { asAddress, asMarketId, asTimestamp, money } from "@slipstream/shared"
import { buildCatalog } from "../read.js"
import { createHyperliquidAdapter, hyperliquidAdapter } from "../index.js"
import { META, SPOT_META, fakeInfo } from "./fixtures.js"

const ADDRESS = asAddress(`0x${"a1".repeat(20)}`)
const CATALOG = buildCatalog(META, SPOT_META, asTimestamp(Date.now()))

describe("the exported singleton", () => {
  it("is a VenueAdapter for hyperliquid", () => {
    expect(hyperliquidAdapter.id).toBe("hyperliquid")
  })

  it("leaves the W11 write methods as stubs", () => {
    expect(() => hyperliquidAdapter.placeOrder({} as never, {} as never)).toThrow(/Not implemented \(W11\)/)
    expect(() => hyperliquidAdapter.cancelOrder({} as never, {} as never)).toThrow(/Not implemented \(W11\)/)
    expect(() => hyperliquidAdapter.closePosition({} as never, {} as never, null)).toThrow(
      /Not implemented \(W11\)/,
    )
  })
})

describe("the metadata cache", () => {
  it("says what to do when constraints() is called before anything loaded it", () => {
    const adapter = createHyperliquidAdapter({ info: fakeInfo() })
    expect(() => adapter.constraints(asMarketId("BTC"))).toThrow(
      /hyperliquid\.constraints: market metadata is not loaded.*warmUp\(\)/s,
    )
    expect(() => adapter.quantize(asMarketId("BTC"), "buy", null, money.fromInt(1))).toThrow(
      /hyperliquid\.quantize: market metadata is not loaded/,
    )
  })

  it("works with zero I/O when handed a prebuilt catalogue", () => {
    const info = fakeInfo()
    const adapter = createHyperliquidAdapter({ info, catalog: CATALOG })
    expect(money.format(adapter.constraints(asMarketId("BTC")).sizeLot)).toBe("0.00001")
    expect(info.calls).toEqual([])
  })

  it("is warm after warmUp, and after any async read", async () => {
    const adapter = createHyperliquidAdapter({ info: fakeInfo() })
    await adapter.warmUp()
    expect(money.format(adapter.constraints(asMarketId("ETH")).priceTick)).toBe("0.01")

    const other = createHyperliquidAdapter({ info: fakeInfo() })
    await other.listMarkets()
    expect(other.constraints(asMarketId("ETH")).supportsShort).toBe(true)
  })

  it("collapses concurrent warm-ups into one pair of requests", async () => {
    // meta and spotMeta weigh 20 each against a 1200/minute shared IP budget.
    const info = fakeInfo()
    const adapter = createHyperliquidAdapter({ info })
    await Promise.all([adapter.warmUp(), adapter.warmUp(), adapter.listMarkets()])
    expect(info.calls.filter((c) => c === "meta")).toHaveLength(1)
    expect(info.calls.filter((c) => c === "spotMeta")).toHaveLength(1)
  })

  it("retries after a failed load rather than caching the failure", async () => {
    let attempt = 0
    const info = fakeInfo({
      meta: async () => {
        attempt += 1
        if (attempt === 1) throw new Error("upstream 503")
        return META
      },
    })
    const adapter = createHyperliquidAdapter({ info })
    await expect(adapter.warmUp()).rejects.toThrow("upstream 503")
    await expect(adapter.warmUp()).resolves.toMatchObject({ markets: expect.any(Array) })
  })

  it("refreshes once the cache has aged out", async () => {
    const info = fakeInfo()
    const adapter = createHyperliquidAdapter({ info, catalogTtlMs: 0 })
    await adapter.warmUp()
    await adapter.warmUp()
    expect(info.calls.filter((c) => c === "meta")).toHaveLength(2)
  })

  it("keeps answering constraints() from a stale catalogue rather than doing I/O", async () => {
    const info = fakeInfo()
    const adapter = createHyperliquidAdapter({ info, catalogTtlMs: 0 })
    await adapter.warmUp()
    const before = info.calls.length
    expect(adapter.constraints(asMarketId("BTC")).supportsShort).toBe(true)
    expect(info.calls.length).toBe(before)
  })
})

describe("delegation to the read layer", () => {
  it("routes quantize through the cached szDecimals", async () => {
    const adapter = createHyperliquidAdapter({ info: fakeInfo(), catalog: CATALOG })
    const order = adapter.quantize(
      asMarketId("BTC"),
      "buy",
      money.parse("77902.531"),
      money.parse("0.0123456789"),
    )
    expect(order.price === null ? null : money.format(order.price)).toBe("77902")
    expect(money.format(order.size)).toBe("0.01234")
    expect(order.belowMinimum).toBe(false)
  })

  it("resolves a market id to a coin before asking for its book", async () => {
    const info = fakeInfo()
    const adapter = createHyperliquidAdapter({ info, catalog: CATALOG })
    const book = await adapter.getBook(asMarketId("BTC"), 2)
    expect(book.bids).toHaveLength(2)
    expect(info.calls).toEqual(["l2Book"])
  })

  it("refuses a market the venue does not list", async () => {
    const adapter = createHyperliquidAdapter({ info: fakeInfo(), catalog: CATALOG })
    await expect(adapter.getBook(asMarketId("NOPE"), 5)).rejects.toThrow(/unknown market/)
    expect(() => adapter.constraints(asMarketId("NOPE"))).toThrow(/unknown market/)
  })

  it("reads positions, account value, fills and budget without needing the catalogue", async () => {
    const adapter = createHyperliquidAdapter({ info: fakeInfo() })
    expect((await adapter.getPositions(ADDRESS)).length).toBe(4)
    expect(money.format(await adapter.getAccountValue(ADDRESS))).toBe("93850.703727")
    expect((await adapter.getFills(ADDRESS, asTimestamp(0))).length).toBe(2)
    expect((await adapter.rateBudget(ADDRESS)).resetsAt).toBeNull()
  })
})

describe("close", () => {
  it("is safe when no socket was ever opened", async () => {
    const adapter = createHyperliquidAdapter({ info: fakeInfo() })
    await expect(adapter.close()).resolves.toBeUndefined()
  })
})
