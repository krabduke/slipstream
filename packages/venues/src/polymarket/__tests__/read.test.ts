/**
 * W7 — Polymarket read adapter.
 *
 * Every fixture below is a payload captured verbatim from the live API on
 * 2026-08-29, trimmed only in length. That matters more than usual here: the
 * defects this adapter can have are not crashes, they are plausible wrong
 * answers — a book read from the wrong end, a position keyed off the wrong
 * address, a timestamp off by a factor of a thousand — and a hand-written
 * fixture would happily agree with the bug.
 */
import { describe, expect, it } from "vitest"
import { money, asAddress, asMarketId, asTimestamp } from "@slipstream/shared"
import type { Decimal } from "@slipstream/shared/money/types.js"
import type { BookDelta, Fill } from "../../types.js"
import {
  createPolymarketRead,
  gammaMarketStatus,
  PolymarketApiError,
  type ClobReader,
  type VenueSocket,
} from "../read.js"

const f = (x: Decimal) => money.format(x)

const YES = "27146956652877944551877724690365745048289675287536243265951843487691050802191"
const NO = "33216695217861742195941369663873573949679634432452142092545486849801915283392"
const WALLET = asAddress("0xe40aaa5ce1dac0b7dc24c9d0284f27e17c3fe4a2")

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface Route {
  readonly match: string
  readonly bodies: readonly unknown[]
}

/** Serves a queued body per matching URL; the last body repeats. Records every
 *  URL so a test can assert on the query it actually sent. */
const stubFetch = (routes: readonly Route[]) => {
  const calls: string[] = []
  const cursors = new Map<string, number>()
  const fetchLike = (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input)
    calls.push(url)
    const route = routes.find((r) => url.includes(r.match))
    if (route === undefined) {
      return Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve("no stub route"),
        json: () => Promise.resolve(null),
      } as unknown as Response)
    }
    const index = cursors.get(route.match) ?? 0
    cursors.set(route.match, index + 1)
    const body = route.bodies[Math.min(index, route.bodies.length - 1)]
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    } as unknown as Response)
  }
  return { fetch: fetchLike as unknown as typeof globalThis.fetch, calls }
}

const stubClob = (books: Record<string, unknown>): ClobReader => ({
  getOrderBook: (tokenId) => Promise.resolve(books[tokenId] as never),
  getVersion: () => Promise.resolve(2),
})

/** Replays a scripted message sequence once the adapter has attached its
 *  listeners, then closes. Later connections deliver nothing. */
const scriptedSocket = (script: readonly unknown[]) => {
  let connections = 0
  const open = (): VenueSocket => {
    connections += 1
    const isFirst = connections === 1
    const listeners = new Map<string, ((event: { data?: unknown }) => void)[]>()
    setTimeout(() => {
      for (const l of listeners.get("open") ?? []) l({})
      if (isFirst) {
        for (const message of script) {
          for (const l of listeners.get("message") ?? []) l({ data: JSON.stringify(message) })
        }
      }
      for (const l of listeners.get("close") ?? []) l({})
    }, 0)
    return {
      send: () => undefined,
      close: () => undefined,
      addEventListener: (type, listener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener])
      },
    }
  }
  return { open, connections: () => connections }
}

const noSleep = () => Promise.resolve()

// ---------------------------------------------------------------------------
// Fixtures — captured live 2026-08-29
// ---------------------------------------------------------------------------

/** Note the ordering: bids ascend and asks descend. Both sides arrive with the
 *  WORST price first, which is the single most dangerous thing about this
 *  payload. Confirmed over REST and the socket. */
const LIVE_BOOK = {
  market: "0x7d0aaf81bbd3fd73b6a1651cce08a452c0cbf9c0cbb4520ce0f981065b639d88",
  asset_id: YES,
  timestamp: "1788019457281",
  hash: "6e75075ff0f80dca3803f221f6cf746e14a61d06",
  bids: [
    { price: "0.001", size: "40" },
    { price: "0.002", size: "2500" },
    { price: "0.003", size: "1488.66" },
    { price: "0.004", size: "710.79" },
    { price: "0.005", size: "1529.75" },
  ],
  asks: [
    { price: "0.999", size: "230.61" },
    { price: "0.998", size: "96.46" },
    { price: "0.95", size: "34000" },
    { price: "0.008", size: "2520.08" },
    { price: "0.007", size: "79.82" },
  ],
  min_order_size: "5",
  tick_size: "0.001",
  neg_risk: true,
  last_trade_price: "0.005",
}

const LIVE_GAMMA_OPEN = {
  id: "2063134",
  question: "Will Adanech Abiebie be the next Prime Minister of Ethiopia?",
  conditionId: "0x7d0aaf81bbd3fd73b6a1651cce08a452c0cbf9c0cbb4520ce0f981065b639d88",
  slug: "will-adanech-abiebie-be-the-next-prime-minister-of-ethiopia",
  endDate: "2026-06-01T00:00:00Z",
  outcomes: '["Yes", "No"]',
  outcomePrices: '["0.006", "0.994"]',
  active: true,
  closed: false,
  archived: false,
  enableOrderBook: true,
  acceptingOrders: true,
  orderPriceMinTickSize: 0.001,
  orderMinSize: 5,
  clobTokenIds: `["${YES}", "${NO}"]`,
  negRisk: true,
}

/** A market that has settled. `closed` alone does not say this — the payout is
 *  what makes the position end without a trade. */
const LIVE_GAMMA_RESOLVED = {
  id: "3616839",
  slug: "chi-hen-ton-2026-08-29-corners-team-away-2pt5",
  active: true,
  closed: true,
  archived: false,
  acceptingOrders: false,
  enableOrderBook: true,
  umaResolutionStatus: "resolved",
  outcomes: '["Over", "Under"]',
  outcomePrices: '["1", "0"]',
  closedTime: "2026-08-29 16:06:04+00",
  endDate: "2026-08-29T12:00:00Z",
  orderPriceMinTickSize: 0.01,
  orderMinSize: 5,
  clobTokenIds: '["111", "222"]',
}

const LIVE_POSITION = {
  proxyWallet: "0xe40aaa5ce1dac0b7dc24c9d0284f27e17c3fe4a2",
  asset: "7424753944577407627798342086224300332261118341771286172561357635231967087849",
  conditionId: "0xa59bb6bb91e5c1e4d533864520fbd3bb75d6d0ebb813b4cd8a8b88479bfa8966",
  size: 48332.4875,
  avgPrice: 0.285,
  initialValue: 13779.3423,
  currentValue: 24.1662,
  cashPnl: -13755.1761,
  realizedPnl: 0,
  curPrice: 0.0005,
  redeemable: false,
  outcome: "Yes",
  endDate: "2026-10-04",
}

const LIVE_TRADE = {
  proxyWallet: "0xe40aaa5ce1dac0b7dc24c9d0284f27e17c3fe4a2",
  side: "BUY",
  asset: "20079610711575208910170777272019060835765540443273210485526036417173312479692",
  conditionId: "0xf25c2e8df5eafe8be2c157670427e0788bb7f615be949ab24ac9a75bb7bdd3a6",
  size: 13.66,
  price: 0.791,
  timestamp: 1788019354,
  outcome: "No",
  transactionHash: "0x8487fbeb09a230f67a8b39d663c0896070817c910e17a15aae129b37b1d8c1da",
}

// ---------------------------------------------------------------------------

describe("getBook", () => {
  const read = () =>
    createPolymarketRead({ clob: stubClob({ [YES]: LIVE_BOOK }), fetch: stubFetch([]).fetch })

  it("returns both sides best-price-first, not in the order the venue sent them", async () => {
    const book = await read().getBook(asMarketId(YES), 10)
    expect(book.bids.map((l) => f(l.price))).toEqual(["0.005", "0.004", "0.003", "0.002", "0.001"])
    expect(book.asks.map((l) => f(l.price))).toEqual(["0.007", "0.008", "0.95", "0.998", "0.999"])
  })

  it("keeps price and size together while reordering", async () => {
    const book = await read().getBook(asMarketId(YES), 10)
    expect(f(book.bids[0]!.size)).toBe("1529.75")
    expect(f(book.asks[0]!.size)).toBe("79.82")
  })

  it("returns real depth rather than a touch summary", async () => {
    const book = await read().getBook(asMarketId(YES), 10)
    expect(book.bids).toHaveLength(5)
    expect(book.asks).toHaveLength(5)
  })

  it("truncates from the best price inward when depth is limited", async () => {
    const book = await read().getBook(asMarketId(YES), 2)
    expect(book.bids.map((l) => f(l.price))).toEqual(["0.005", "0.004"])
    expect(book.asks.map((l) => f(l.price))).toEqual(["0.007", "0.008"])
  })

  it("reads the venue timestamp in milliseconds", async () => {
    const book = await read().getBook(asMarketId(YES), 5)
    expect(book.ts).toBe(asTimestamp(1788019457281))
  })

  it("teaches constraints() the market's real tick", async () => {
    const adapter = createPolymarketRead({
      clob: stubClob({ [YES]: { ...LIVE_BOOK, tick_size: "0.01" } }),
    })
    expect(f(adapter.constraints(asMarketId(YES)).priceTick)).toBe("0.001")
    await adapter.getBook(asMarketId(YES), 5)
    expect(f(adapter.constraints(asMarketId(YES)).priceTick)).toBe("0.01")
    // and quantize follows the constraint, without the caller passing anything
    const q = adapter.quantize(asMarketId(YES), "buy", money.parse("0.6157"), money.parse("100"))
    expect(f(q.price!)).toBe("0.61")
  })

  it("refuses a non-positive depth instead of guessing", async () => {
    await expect(read().getBook(asMarketId(YES), 0)).rejects.toThrow(RangeError)
    await expect(read().getBook(asMarketId(YES), -1)).rejects.toThrow(RangeError)
    await expect(read().getBook(asMarketId(YES), 1.5)).rejects.toThrow(RangeError)
  })

  it("refuses a book for a different token than the one asked for", async () => {
    const adapter = createPolymarketRead({
      clob: stubClob({ [YES]: { ...LIVE_BOOK, asset_id: NO } }),
    })
    await expect(adapter.getBook(asMarketId(YES), 5)).rejects.toThrow(/answered for/)
  })
})

describe("listMarkets", () => {
  const gammaPages = (rows: readonly unknown[][]) =>
    rows.map((markets, i) => ({
      markets,
      next_cursor: i === rows.length - 1 ? "" : `cursor-${String(i)}`,
    }))

  it("emits one Market per outcome, because a MarketId is an outcome", async () => {
    const stub = stubFetch([
      { match: "/markets/keyset", bodies: gammaPages([[LIVE_GAMMA_OPEN]]) },
    ])
    const markets = await createPolymarketRead({ fetch: stub.fetch }).listMarkets()
    expect(markets.map((m) => m.id)).toEqual([YES, NO])
    expect(markets[0]!.symbol).toContain("(Yes)")
    expect(markets[1]!.symbol).toContain("(No)")
    expect(markets.every((m) => m.kind === "binary-outcome")).toBe(true)
    expect(markets.every((m) => m.constraints.supportsShort === false)).toBe(true)
  })

  it("distinguishes a settled market from one that merely stopped trading", async () => {
    const stub = stubFetch([
      {
        match: "/markets/keyset",
        bodies: [
          { markets: [LIVE_GAMMA_OPEN], next_cursor: "" },
          { markets: [LIVE_GAMMA_RESOLVED], next_cursor: "" },
        ],
      },
    ])
    const markets = await createPolymarketRead({ fetch: stub.fetch }).listMarkets()
    const byId = new Map(markets.map((m) => [m.id, m]))
    expect(byId.get(asMarketId(YES))!.status).toBe("open")
    expect(byId.get(asMarketId("111"))!.status).toBe("resolved")
  })

  it("carries each market's own tick into its constraints", async () => {
    const stub = stubFetch([
      {
        match: "/markets/keyset",
        bodies: [
          { markets: [LIVE_GAMMA_OPEN], next_cursor: "" },
          { markets: [LIVE_GAMMA_RESOLVED], next_cursor: "" },
        ],
      },
    ])
    const adapter = createPolymarketRead({ fetch: stub.fetch })
    await adapter.listMarkets()
    expect(f(adapter.constraints(asMarketId(YES)).priceTick)).toBe("0.001")
    expect(f(adapter.constraints(asMarketId("111")).priceTick)).toBe("0.01")
  })

  it("reads resolvesAt from the venue and tolerates its absence", async () => {
    const stub = stubFetch([
      {
        match: "/markets/keyset",
        bodies: [
          { markets: [LIVE_GAMMA_OPEN, { ...LIVE_GAMMA_OPEN, endDate: undefined, clobTokenIds: '["9"]', outcomes: '["Yes"]' }], next_cursor: "" },
          { markets: [], next_cursor: "" },
        ],
      },
    ])
    const markets = await createPolymarketRead({ fetch: stub.fetch }).listMarkets()
    expect(markets[0]!.resolvesAt).toBe(asTimestamp(Date.parse("2026-06-01T00:00:00Z")))
    expect(markets.find((m) => m.id === "9")!.resolvesAt).toBeNull()
  })

  it("pages with after_cursor — the response field name does not work as a request field", async () => {
    const stub = stubFetch([
      {
        match: "/markets/keyset",
        bodies: [
          { markets: [LIVE_GAMMA_OPEN], next_cursor: "page-2" },
          { markets: [LIVE_GAMMA_RESOLVED], next_cursor: "" },
          { markets: [], next_cursor: "" },
        ],
      },
    ])
    await createPolymarketRead({ fetch: stub.fetch }).listMarkets()
    expect(stub.calls[1]).toContain("after_cursor=page-2")
    expect(stub.calls[1]).not.toContain("next_cursor=")
  })

  it("asks for the settled pass by volume and by close date, not by liquidity", async () => {
    const stub = stubFetch([
      { match: "/markets/keyset", bodies: [{ markets: [], next_cursor: "" }] },
    ])
    await createPolymarketRead({
      fetch: stub.fetch,
      now: () => Date.parse("2026-08-29T00:00:00Z"),
      listMarkets: { closedLookbackMs: 86_400_000 },
    }).listMarkets()

    expect(stub.calls[0]).toContain("closed=false")
    expect(stub.calls[0]).toContain("liquidity_num_min=")
    // A closed market's book is gone, so its liquidity is zero and filtering
    // the settled pass on liquidity would return nothing at all.
    expect(stub.calls[1]).toContain("closed=true")
    expect(stub.calls[1]).toContain("volume_num_min=")
    expect(stub.calls[1]).not.toContain("liquidity_num_min=")
    expect(decodeURIComponent(stub.calls[1]!)).toContain("end_date_min=2026-08-28T00:00:00.000Z")
  })

  it("throws rather than silently returning a truncated market list", async () => {
    const stub = stubFetch([
      { match: "/markets/keyset", bodies: [{ markets: [LIVE_GAMMA_OPEN], next_cursor: "more" }] },
    ])
    await expect(
      createPolymarketRead({ fetch: stub.fetch, listMarkets: { maxPages: 3 } }).listMarkets(),
    ).rejects.toThrow(/exceeded 3 pages/)
  })

  it("surfaces an HTTP failure instead of returning an empty universe", async () => {
    const adapter = createPolymarketRead({ fetch: stubFetch([]).fetch })
    await expect(adapter.listMarkets()).rejects.toBeInstanceOf(PolymarketApiError)
  })
})

describe("gammaMarketStatus", () => {
  it("maps every live shape observed", () => {
    expect(gammaMarketStatus(LIVE_GAMMA_OPEN)).toBe("open")
    expect(gammaMarketStatus(LIVE_GAMMA_RESOLVED)).toBe("resolved")
    // Closed but not yet settled: trading is over, the payout is not decided.
    expect(gammaMarketStatus({ closed: true })).toBe("closed")
    // A resolved market is still `closed: true`; resolution must win.
    expect(gammaMarketStatus({ closed: true, umaResolutionStatus: "resolved" })).toBe("resolved")
    expect(gammaMarketStatus({ closed: false, acceptingOrders: false })).toBe("halted")
    expect(gammaMarketStatus({ closed: false, active: false })).toBe("halted")
  })
})

describe("getPositions", () => {
  it("maps a live position without leverage or a liquidation price", async () => {
    const stub = stubFetch([{ match: "/positions", bodies: [[LIVE_POSITION]] }])
    const [position] = await createPolymarketRead({ fetch: stub.fetch }).getPositions(WALLET)

    expect(position!.venue).toBe("polymarket")
    expect(position!.marketId).toBe(LIVE_POSITION.asset)
    // Holding an outcome token is the only position that exists: the bearish
    // expression is the other token, which is a different MarketId.
    expect(position!.side).toBe("long")
    expect(f(position!.size)).toBe("48332.4875")
    expect(f(position!.entryPrice)).toBe("0.285")
    expect(f(position!.notional)).toBe("24.1662")
    expect(position!.leverage).toBeNull()
    expect(position!.liquidationPrice).toBeNull()
  })

  it("reports unrealised PnL as the move on shares still held", async () => {
    const stub = stubFetch([{ match: "/positions", bodies: [[LIVE_POSITION]] }])
    const [position] = await createPolymarketRead({ fetch: stub.fetch }).getPositions(WALLET)
    // currentValue - initialValue, exactly, and not the realised figure that
    // belongs to size already closed.
    expect(f(position!.unrealizedPnl)).toBe("-13755.1761")
    expect(
      f(
        money.sub(
          money.parse(String(LIVE_POSITION.currentValue)),
          money.parse(String(LIVE_POSITION.initialValue)),
        ),
      ),
    ).toBe("-13755.1761")
  })

  it("keys the query on the address it was given — the proxy wallet", async () => {
    const stub = stubFetch([{ match: "/positions", bodies: [[]]} ])
    await createPolymarketRead({ fetch: stub.fetch }).getPositions(WALLET)
    expect(stub.calls[0]).toContain(`user=${String(WALLET)}`)
    // The endpoint's own default threshold hides dust; a position we cannot
    // see is a position we cannot reconcile.
    expect(stub.calls[0]).toContain("sizeThreshold=0")
  })

  it("pages until the venue returns a short page", async () => {
    const full = Array.from({ length: 500 }, (_, i) => ({ ...LIVE_POSITION, asset: String(i) }))
    const stub = stubFetch([{ match: "/positions", bodies: [full, [LIVE_POSITION]] }])
    const positions = await createPolymarketRead({ fetch: stub.fetch }).getPositions(WALLET)
    expect(positions).toHaveLength(501)
    expect(stub.calls[1]).toContain("offset=500")
  })

  it("drops rows the venue reports at zero size", async () => {
    const stub = stubFetch([
      { match: "/positions", bodies: [[{ ...LIVE_POSITION, size: 0 }]] },
    ])
    const positions = await createPolymarketRead({ fetch: stub.fetch }).getPositions(WALLET)
    expect(positions).toHaveLength(0)
  })
})

describe("getAccountValue", () => {
  it("reads the portfolio value for the matching wallet", async () => {
    const stub = stubFetch([
      { match: "/value", bodies: [[{ user: String(WALLET), value: 5463.1411 }]] },
    ])
    const value = await createPolymarketRead({ fetch: stub.fetch }).getAccountValue(WALLET)
    expect(f(value)).toBe("5463.1411")
  })

  it("treats an unknown wallet as zero, not as an error", async () => {
    const stub = stubFetch([{ match: "/value", bodies: [[]] }])
    const value = await createPolymarketRead({ fetch: stub.fetch }).getAccountValue(WALLET)
    expect(f(value)).toBe("0")
  })

  it("captures a JSON float exactly rather than re-rounding it", async () => {
    // The Data API sends money as JSON numbers, and they arrive carrying their
    // own float noise (0.6299999989 was observed live). Whatever we do the
    // double is what the venue sent; what must not happen is adding error of
    // our own on top of it.
    const stub = stubFetch([
      { match: "/value", bodies: [[{ user: String(WALLET), value: 0.6299999989 }]] },
    ])
    const value = await createPolymarketRead({ fetch: stub.fetch }).getAccountValue(WALLET)
    expect(f(value)).toBe("0.6299999989")
  })
})

describe("getFills", () => {
  it("maps a live trade, converting seconds to milliseconds", async () => {
    const stub = stubFetch([{ match: "/trades", bodies: [[LIVE_TRADE]] }])
    const [fill] = await createPolymarketRead({ fetch: stub.fetch }).getFills(
      WALLET,
      asTimestamp(0),
    )
    expect(fill!.venue).toBe("polymarket")
    expect(fill!.marketId).toBe(LIVE_TRADE.asset)
    expect(fill!.side).toBe("buy")
    expect(f(fill!.price)).toBe("0.791")
    expect(f(fill!.size)).toBe("13.66")
    // The venue's field is epoch seconds; Timestamp is epoch milliseconds.
    expect(fill!.ts).toBe(asTimestamp(1_788_019_354_000))
    expect(fill!.closedPnl).toBeNull()
  })

  it("derives a fill id that separates two trades in one transaction", async () => {
    const sibling = { ...LIVE_TRADE, size: 20, price: 0.42 }
    const stub = stubFetch([{ match: "/trades", bodies: [[LIVE_TRADE, sibling]] }])
    const fills = await createPolymarketRead({ fetch: stub.fetch }).getFills(WALLET, asTimestamp(0))
    expect(new Set(fills.map((x) => x.id)).size).toBe(2)
    expect(fills[0]!.id).toContain(LIVE_TRADE.transactionHash)
  })

  it("excludes trades older than `since` and stops paging once it reaches them", async () => {
    const older = { ...LIVE_TRADE, timestamp: 1_788_000_000, transactionHash: "0xold" }
    const stub = stubFetch([{ match: "/trades", bodies: [[LIVE_TRADE, older]] }])
    const fills = await createPolymarketRead({ fetch: stub.fetch }).getFills(
      WALLET,
      asTimestamp(1_788_010_000_000),
    )
    expect(fills).toHaveLength(1)
    expect(fills[0]!.ts).toBe(asTimestamp(1_788_019_354_000))
    expect(stub.calls).toHaveLength(1)
  })

  it("includes a fill exactly on the `since` boundary", async () => {
    const stub = stubFetch([{ match: "/trades", bodies: [[LIVE_TRADE]] }])
    const fills = await createPolymarketRead({ fetch: stub.fetch }).getFills(
      WALLET,
      asTimestamp(1_788_019_354_000),
    )
    expect(fills).toHaveLength(1)
  })

  it("asks for maker fills too, not only the taker side", async () => {
    const stub = stubFetch([{ match: "/trades", bodies: [[]] }])
    await createPolymarketRead({ fetch: stub.fetch }).getFills(WALLET, asTimestamp(0))
    expect(stub.calls[0]).toContain("takerOnly=false")
  })

  it("rejects a side it does not recognise rather than guessing a direction", async () => {
    const stub = stubFetch([{ match: "/trades", bodies: [[{ ...LIVE_TRADE, side: "MINT" }]] }])
    await expect(
      createPolymarketRead({ fetch: stub.fetch }).getFills(WALLET, asTimestamp(0)),
    ).rejects.toThrow(/unknown trade side/)
  })
})

describe("watchFills", () => {
  it("treats the first poll as a state reset and emits nothing from it", async () => {
    const second = { ...LIVE_TRADE, transactionHash: "0xnew", timestamp: 1_788_019_400 }
    const stub = stubFetch([{ match: "/trades", bodies: [[LIVE_TRADE], [second, LIVE_TRADE]] }])
    const adapter = createPolymarketRead({ fetch: stub.fetch, sleep: noSleep })

    const seen: Fill[] = []
    for await (const fill of adapter.watchFills([WALLET])) {
      seen.push(fill)
      break
    }
    // Only the trade that appeared after the seed. Emitting the seed would
    // replay a leader's whole recent history on every restart.
    expect(seen).toHaveLength(1)
    expect(seen[0]!.id).toContain("0xnew")
  })

  it("does not re-emit a fill it has already reported", async () => {
    const second = { ...LIVE_TRADE, transactionHash: "0xnew", timestamp: 1_788_019_400 }
    const third = { ...LIVE_TRADE, transactionHash: "0xthird", timestamp: 1_788_019_500 }
    const stub = stubFetch([
      {
        match: "/trades",
        bodies: [[LIVE_TRADE], [second, LIVE_TRADE], [third, second, LIVE_TRADE]],
      },
    ])
    const adapter = createPolymarketRead({ fetch: stub.fetch, sleep: noSleep })

    const seen: Fill[] = []
    for await (const fill of adapter.watchFills([WALLET])) {
      seen.push(fill)
      if (seen.length === 2) break
    }
    expect(seen.map((x) => x.id.split(":")[0])).toEqual(["0xnew", "0xthird"])
  })
})

describe("watchBook", () => {
  const SNAPSHOT = [{ ...LIVE_BOOK, event_type: "book" }]
  const CHANGE = {
    market: LIVE_BOOK.market,
    event_type: "price_change",
    timestamp: "1788019755426",
    price_changes: [
      // A change for the sibling outcome, which the channel delivers even
      // though it was never subscribed to.
      { asset_id: NO, price: "0.925", size: "0", side: "BUY" },
      { asset_id: YES, price: "0.075", size: "12", side: "SELL" },
    ],
  }

  const collect = async (script: readonly unknown[], count: number): Promise<BookDelta[]> => {
    const socket = scriptedSocket(script)
    const adapter = createPolymarketRead({ openSocket: socket.open, sleep: noSleep })
    const out: BookDelta[] = []
    for await (const delta of adapter.watchBook([asMarketId(YES)])) {
      out.push(delta)
      if (out.length === count) break
    }
    return out
  }

  it("marks the first message a snapshot and orders it best-first", async () => {
    const [snapshot] = await collect([SNAPSHOT], 1)
    expect(snapshot!.isSnapshot).toBe(true)
    expect(snapshot!.marketId).toBe(YES)
    expect(snapshot!.bids.map((l) => f(l.price))[0]).toBe("0.005")
    expect(snapshot!.asks.map((l) => f(l.price))[0]).toBe("0.007")
  })

  it("marks later messages as deltas and filters out unsubscribed outcomes", async () => {
    const [, change] = await collect([SNAPSHOT, CHANGE], 2)
    expect(change!.isSnapshot).toBe(false)
    expect(change!.marketId).toBe(YES)
    // The NO leg was in the same message and must not appear.
    expect(change!.bids).toHaveLength(0)
    expect(change!.asks).toHaveLength(1)
    expect(f(change!.asks[0]!.price)).toBe("0.075")
    expect(change!.ts).toBe(asTimestamp(1788019755426))
  })

  it("carries a removal through as a zero-size level rather than dropping it", async () => {
    const removal = {
      ...CHANGE,
      price_changes: [{ asset_id: YES, price: "0.005", size: "0", side: "BUY" }],
    }
    const [, change] = await collect([SNAPSHOT, removal], 2)
    expect(change!.bids).toHaveLength(1)
    expect(f(change!.bids[0]!.size)).toBe("0")
  })

  it("gives up loudly when a socket keeps connecting and delivering nothing", async () => {
    const socket = scriptedSocket([])
    const adapter = createPolymarketRead({
      openSocket: socket.open,
      sleep: noSleep,
      book: { maxReconnects: 3 },
    })
    const run = async () => {
      for await (const _ of adapter.watchBook([asMarketId(YES)])) break
    }
    await expect(run()).rejects.toThrow(/produced no data/)
    expect(socket.connections()).toBe(3)
  })
})

describe("rateBudget", () => {
  it("reports an unbounded budget rather than inventing a measured one", async () => {
    // Polymarket meters per IP, not per address, and no host returns a
    // rate-limit header of any kind. A number here would be fiction that a UI
    // meter would then present as fact.
    const budget = await createPolymarketRead().rateBudget(WALLET)
    expect(budget.remaining).toBe(Number.POSITIVE_INFINITY)
    expect(budget.resetsAt).toBeNull()
  })
})
