/**
 * W6 — Hyperliquid `/info` reads, against fixtures captured from the live API.
 *
 * The mapping assertions are checkable by hand against the fixture file: a
 * position of `szi: "-5.99995"` must come back as a short of size 5.99995, and
 * an account value of `93850.703727` must come back with those digits intact
 * rather than a float's approximation of them.
 */
import { describe, expect, it } from "vitest"
import { asAddress, asMarketId, asTimestamp, money } from "@slipstream/shared"
import type { UserFillsResponse } from "@nktkas/hyperliquid/api/info"
import {
  FILLS_PAGE_LIMIT,
  buildCatalog,
  fetchCatalog,
  getAccountValue,
  getBook,
  getFills,
  getPositions,
  lookupSpec,
  rateBudget,
  verifyDelegation,
} from "../read.js"
import {
  AGENTS,
  META,
  OWNER,
  SIGNER,
  SPOT_META,
  STRANGER,
  USER_FILLS,
  fakeInfo,
} from "./fixtures.js"

const AT = asTimestamp(1788019610170)
const catalog = buildCatalog(META, SPOT_META, AT)
const ADDRESS = asAddress("0xf191539A2c4bA0af951438bb6ABFA0625C7dF2ef")

describe("buildCatalog", () => {
  it("indexes perps and spot pairs under the id the venue itself accepts", () => {
    // The MarketId is the wire name, so /info and the WS need no translation.
    expect(lookupSpec(catalog, asMarketId("BTC"), "test").coin).toBe("BTC")
    expect(lookupSpec(catalog, asMarketId("@107"), "test").coin).toBe("@107")
    expect(lookupSpec(catalog, asMarketId("PURR/USDC"), "test").coin).toBe("PURR/USDC")
  })

  it("labels a spot pair by its tokens while keeping @n as the identifier", () => {
    const hype = lookupSpec(catalog, asMarketId("@107"), "test")
    expect(hype.marketId).toBe("@107")
    expect(hype.symbol).toBe("HYPE/USDC")
    // Size precision on a spot pair comes from the base token, not the quote.
    expect(hype.szDecimals).toBe(2)
  })

  it("takes szDecimals and leverage from the venue rather than assuming them", () => {
    expect(lookupSpec(catalog, asMarketId("BTC"), "test").szDecimals).toBe(5)
    expect(
      money.format(lookupSpec(catalog, asMarketId("BTC"), "test").constraints.maxLeverage),
    ).toBe("40")
    expect(
      money.format(lookupSpec(catalog, asMarketId("ETH"), "test").constraints.maxLeverage),
    ).toBe("25")
  })

  it("reports a delisted perp as closed, not as open with no liquidity", () => {
    const markets = new Map(catalog.markets.map((m) => [m.id, m]))
    expect(markets.get(asMarketId("MATIC"))?.status).toBe("closed")
    expect(markets.get(asMarketId("BTC"))?.status).toBe("open")
    // `resolved` is Polymarket's; a perp never settles on a clock.
    expect(markets.get(asMarketId("BTC"))?.resolvesAt).toBeNull()
  })

  it("refuses a duplicate market id instead of silently keeping one", () => {
    const collide = { ...SPOT_META, universe: [{ tokens: [1, 0] as [number, number], name: "BTC", index: 9, isCanonical: true }] }
    expect(() => buildCatalog(META, collide, AT)).toThrow(/duplicate market id BTC/)
  })

  it("refuses a spot pair whose tokens are not in the token table", () => {
    const dangling = { ...SPOT_META, universe: [{ tokens: [999, 0] as [number, number], name: "@999", index: 999, isCanonical: false }] }
    expect(() => buildCatalog(META, dangling, AT)).toThrow(/unknown token index 999/)
  })
})

describe("lookupSpec", () => {
  it("names the unknown market rather than returning undefined", () => {
    expect(() => lookupSpec(catalog, asMarketId("NOPE"), "getBook")).toThrow(
      /hyperliquid\.getBook: unknown market "NOPE"/,
    )
  })
})

describe("fetchCatalog", () => {
  it("reads meta and spotMeta together", async () => {
    const info = fakeInfo()
    const loaded = await fetchCatalog(info)
    expect(info.calls.sort()).toEqual(["meta", "spotMeta"])
    expect(loaded.markets.length).toBe(META.universe.length + SPOT_META.universe.length)
  })
})

describe("getBook", () => {
  it("maps levels to Decimals and truncates to the requested depth", async () => {
    const book = await getBook(fakeInfo(), lookupSpec(catalog, asMarketId("BTC"), "t"), 2)
    expect(book.marketId).toBe("BTC")
    expect(book.ts).toBe(1788019624369)
    expect(book.bids.map((l) => money.format(l.price))).toEqual(["77902.0", "77901.0"])
    expect(book.asks.map((l) => money.format(l.price))).toEqual(["77903.0", "77904.0"])
    expect(money.format(book.bids[0]?.size ?? money.fromInt(0))).toBe("4.41798")
  })

  it("throws when the venue has no such market, rather than returning an empty book", async () => {
    // A depth gate must not read "market does not exist" as "market is thin".
    const info = fakeInfo({ l2Book: async () => null })
    await expect(getBook(info, lookupSpec(catalog, asMarketId("BTC"), "t"), 5)).rejects.toThrow(
      /no order book for BTC/,
    )
  })

  it("rejects a nonsense depth", async () => {
    const spec = lookupSpec(catalog, asMarketId("BTC"), "t")
    await expect(getBook(fakeInfo(), spec, 0)).rejects.toThrow(/positive integer/)
  })
})

describe("getPositions", () => {
  it("splits the signed size into a side and a positive magnitude", async () => {
    const positions = await getPositions(fakeInfo(), ADDRESS)
    const btc = positions.find((p) => p.marketId === "BTC")
    expect(btc?.side).toBe("short")
    expect(money.format(btc?.size ?? money.fromInt(0))).toBe("5.99995")
    expect(money.format(btc?.entryPrice ?? money.fromInt(0))).toBe("75999.4")
    expect(money.format(btc?.notional ?? money.fromInt(0))).toBe("467408.1049")
    expect(money.format(btc?.unrealizedPnl ?? money.fromInt(0))).toBe("-11415.33054")
    expect(money.format(btc?.leverage ?? money.fromInt(0))).toBe("40")
    expect(money.format(btc?.liquidationPrice ?? money.fromInt(0))).toBe("107161.0167177731")
  })

  it("reads a positive szi as a long", async () => {
    const positions = await getPositions(fakeInfo(), ADDRESS)
    const hype = positions.find((p) => p.marketId === "HYPE")
    expect(hype?.side).toBe("long")
    expect(money.format(hype?.size ?? money.fromInt(0))).toBe("500.0")
    // The venue reports no liquidation price for this position; do not invent one.
    expect(hype?.liquidationPrice).toBeNull()
  })

  it("drops a flat position rather than reporting a zero-size long", async () => {
    const flat = {
      ...(await fakeInfo().clearinghouseState({ user: OWNER })),
    }
    const info = fakeInfo({
      clearinghouseState: async () => ({
        ...flat,
        assetPositions: flat.assetPositions.map((p) => ({
          ...p,
          position: { ...p.position, szi: "0.0" },
        })),
      }),
    })
    expect(await getPositions(info, ADDRESS)).toEqual([])
  })

  it("rejects an address that is not 20 hex bytes before calling the venue", async () => {
    const info = fakeInfo()
    await expect(getPositions(info, asAddress("not-an-address"))).rejects.toThrow(
      /not a 20-byte hex address/,
    )
    expect(info.calls).toEqual([])
  })
})

describe("getAccountValue", () => {
  it("keeps every digit the venue sent", async () => {
    const value = await getAccountValue(fakeInfo(), ADDRESS)
    // parseFloat would round-trip this fine, but 93850.703727 * 3 would not.
    expect(money.format(value)).toBe("93850.703727")
    expect(value).toEqual({ mantissa: 93850703727n, scale: 6 })
  })
})

describe("getFills", () => {
  it("maps a venue fill onto the adapter's shape", async () => {
    const fills = await getFills(fakeInfo(), ADDRESS, asTimestamp(0))
    const sell = fills[0]
    expect(sell?.id).toBe("678999364071316")
    expect(sell?.marketId).toBe("@107")
    expect(sell?.side).toBe("sell")
    expect(money.format(sell?.price ?? money.fromInt(0))).toBe("55.462")
    expect(money.format(sell?.closedPnl ?? money.fromInt(0))).toBe("-0.49093446")
    expect(sell?.ts).toBe(1785307090387)
    // The address is the one asked for, normalised.
    expect(sell?.address).toBe(ADDRESS.toLowerCase())
  })

  it("reads side B as a buy and adds the builder fee to the fill's cost", async () => {
    const fills = await getFills(fakeInfo(), ADDRESS, asTimestamp(0))
    const buy = fills[1]
    expect(buy?.side).toBe("buy")
    // 0.1 exchange fee + 0.02 builder fee. Both were charged on this fill.
    expect(money.format(buy?.fee ?? money.fromInt(0))).toBe("0.12")
  })

  it("pages until a short page arrives, deduplicating the overlap by tid", async () => {
    const page = (from: number): UserFillsResponse =>
      Array.from({ length: FILLS_PAGE_LIMIT }, (_, i) => {
        const source = USER_FILLS[0]
        if (source === undefined) throw new Error("fixture missing")
        return { ...source, tid: from + i, time: 1_000 + from + i }
      })
    const pages = [page(0), page(FILLS_PAGE_LIMIT - 1), USER_FILLS.slice(0, 1)]
    let call = 0
    const info = fakeInfo({
      userFillsByTime: async () => {
        const next = pages[call]
        call += 1
        return next ?? []
      },
    })
    const fills = await getFills(info, ADDRESS, asTimestamp(0))
    // The second page deliberately repeats the last fill of the first; the
    // database's venue_fill_id UNIQUE would swallow it, but the adapter must not
    // hand out the duplicate in the first place.
    expect(call).toBe(3)
    expect(new Set(fills.map((f) => f.id)).size).toBe(fills.length)
    expect(fills.length).toBe(FILLS_PAGE_LIMIT * 2)
  })

  it("throws rather than returning a silently truncated history", async () => {
    const source = USER_FILLS[0]
    if (source === undefined) throw new Error("fixture missing")
    let tid = 0
    const info = fakeInfo({
      userFillsByTime: async ({ startTime }) =>
        Array.from({ length: FILLS_PAGE_LIMIT }, (_, i) => {
          tid += 1
          return { ...source, tid, time: Number(startTime) + i + 1 }
        }),
    })
    await expect(getFills(info, ADDRESS, asTimestamp(0))).rejects.toThrow(/narrow the window/)
  })

  it("throws when the time window cannot advance", async () => {
    const source = USER_FILLS[0]
    if (source === undefined) throw new Error("fixture missing")
    let tid = 0
    const info = fakeInfo({
      userFillsByTime: async () =>
        Array.from({ length: FILLS_PAGE_LIMIT }, () => {
          tid += 1
          return { ...source, tid, time: 500 }
        }),
    })
    await expect(getFills(info, ADDRESS, asTimestamp(500))).rejects.toThrow(
      /share timestamp 500/,
    )
  })

  it("rejects a since that is not epoch milliseconds", async () => {
    await expect(getFills(fakeInfo(), ADDRESS, asTimestamp(-1))).rejects.toThrow(
      /epoch milliseconds/,
    )
  })
})

describe("rateBudget", () => {
  it("reports what is left, and no reset time it cannot honestly give", async () => {
    // 30993579 cap - 16083 used. The per-address budget refills with trading
    // volume, not with time, so there is no reset instant to report.
    expect(await rateBudget(fakeInfo(), ADDRESS)).toEqual({
      remaining: 30977496,
      resetsAt: null,
    })
  })

  it("floors at zero rather than reporting a negative budget", async () => {
    const info = fakeInfo({
      userRateLimit: async () => ({
        cumVlm: "0",
        nRequestsUsed: 11_000,
        nRequestsCap: 10_000,
        nRequestsSurplus: 0,
      }),
    })
    expect((await rateBudget(info, ADDRESS)).remaining).toBe(0)
  })
})

describe("verifyDelegation", () => {
  it("proves a registered agent and records exactly what was checked", async () => {
    const proof = await verifyDelegation(fakeInfo(), asAddress(OWNER), asAddress(SIGNER))
    expect(proof.venue).toBe("hyperliquid")
    expect(proof.owner).toBe(OWNER)
    expect(proof.signer).toBe(SIGNER)
    expect(proof.canWithdraw).toBe(false)
    expect(proof.method).toContain("extraAgents")
    expect(proof.method).toContain(SIGNER)
    expect(proof.method).toContain('"slipstream"')
    expect(proof.method).toContain("cannot withdraw")
  })

  it("rejects a signer that is not in the owner's agent list", async () => {
    await expect(
      verifyDelegation(fakeInfo(), asAddress(OWNER), asAddress(STRANGER)),
    ).rejects.toThrow(/not a registered agent/)
  })

  it("rejects an empty agent list", async () => {
    const info = fakeInfo({ extraAgents: async () => [] })
    await expect(verifyDelegation(info, asAddress(OWNER), asAddress(SIGNER))).rejects.toThrow(
      /not a registered agent/,
    )
  })

  it("rejects the owner delegating to itself — a master key can withdraw", async () => {
    const info = fakeInfo()
    await expect(verifyDelegation(info, asAddress(OWNER), asAddress(OWNER))).rejects.toThrow(
      /is the owner itself/,
    )
    // And it says so without asking the venue.
    expect(info.calls).toEqual([])
  })

  it("rejects an expired agent", async () => {
    const info = fakeInfo({
      extraAgents: async () => [{ ...AGENTS[0]!, validUntil: Date.now() - 1000 }],
    })
    await expect(verifyDelegation(info, asAddress(OWNER), asAddress(SIGNER))).rejects.toThrow(
      /expired at/,
    )
  })

  it("accepts an agent whose validity has not lapsed", async () => {
    const validUntil = Date.now() + 86_400_000
    const info = fakeInfo({ extraAgents: async () => [{ ...AGENTS[0]!, validUntil }] })
    const proof = await verifyDelegation(info, asAddress(OWNER), asAddress(SIGNER))
    expect(proof.method).toContain(new Date(validUntil).toISOString())
  })

  it("fails closed on a transport error — never a warning", async () => {
    const info = fakeInfo({
      extraAgents: async () => {
        throw new Error("upstream 503")
      },
    })
    await expect(verifyDelegation(info, asAddress(OWNER), asAddress(SIGNER))).rejects.toThrow(
      "upstream 503",
    )
  })

  it("matches an agent listed in a different case", async () => {
    const info = fakeInfo({
      extraAgents: async () => [
        { ...AGENTS[0]!, address: SIGNER.toUpperCase().replace("0X", "0x") as `0x${string}` },
      ],
    })
    await expect(
      verifyDelegation(info, asAddress(OWNER), asAddress(SIGNER)),
    ).resolves.toMatchObject({ canWithdraw: false })
  })
})
