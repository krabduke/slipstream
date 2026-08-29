/**
 * W7 — Polymarket read adapter. Contract: ../types.ts — do not modify it.
 *
 * Four REST surfaces with four different data models, plus a socket. They are
 * NOT interchangeable and a value from one is not an identifier in another:
 *
 *   Gamma     https://gamma-api.polymarket.com   metadata, slugs, resolution
 *   CLOB      https://clob.polymarket.com        books, prices, tick sizes
 *   Data API  https://data-api.polymarket.com    positions, trades, portfolio
 *   WSS       ws-subscriptions-clob…/ws/market   book snapshots and deltas
 *
 * The identifier that ties them together is the **CLOB token id**, which is
 * what `MarketId` is here. It names an *outcome*, not a question: YES and NO of
 * the same market are two different `MarketId`s. Gamma's `conditionId` and its
 * numeric `id` are different keys again, and neither is a `MarketId`.
 *
 * Everything in this file is a read. Nothing here signs, and nothing here needs
 * credentials: every endpoint used is public. Writes are W12's (`write.ts`),
 * credentials are W10's (`auth.ts`).
 *
 * Facts below marked "verified" were checked against the live API on
 * 2026-08-29, not taken from documentation.
 */
import { ClobClient, Chain, type OrderBookSummary } from "@polymarket/clob-client-v2"
import { money, asAddress, asMarketId, asTimestamp } from "@slipstream/shared"
import type { Decimal } from "@slipstream/shared/money/types.js"
import type { Address, MarketId, Timestamp, VenueFillId } from "@slipstream/shared/brand.js"
import type {
  Book,
  BookDelta,
  BookLevel,
  Fill,
  Market,
  MarketConstraints,
  MarketStatus,
  OrderSide,
  Position,
  QuantizedOrder,
  VenueAdapter,
} from "../types.js"
import {
  DEFAULT_MARKET_RULES,
  polymarketConstraints,
  quantizePolymarketOrder,
  type PolymarketMarketRules,
} from "./quantize.js"

// ---------------------------------------------------------------------------
// Hosts and wire limits
// ---------------------------------------------------------------------------

export interface PolymarketHosts {
  readonly gamma: string
  readonly clob: string
  readonly dataApi: string
  readonly wsMarket: string
}

export const POLYMARKET_HOSTS: PolymarketHosts = Object.freeze({
  gamma: "https://gamma-api.polymarket.com",
  clob: "https://clob.polymarket.com",
  dataApi: "https://data-api.polymarket.com",
  wsMarket: "wss://ws-subscriptions-clob.polymarket.com/ws/market",
})

/** Gamma caps a page at 100 whatever `limit` says — verified: `limit=500` and
 *  `limit=1000` both return 100 rows. */
const GAMMA_PAGE = 100

/** The Data API honours larger pages: `limit=1000` on `/trades` returns 1000,
 *  while `/positions` tops out at 500 — verified. */
const DATA_POSITIONS_PAGE = 500
const DATA_TRADES_PAGE = 500

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** An HTTP failure, kept distinguishable from a mapping bug. The body snippet
 *  is truncated because these end up in logs; none of these endpoints take or
 *  return credentials, so there is nothing secret in a public read's URL. */
export class PolymarketApiError extends Error {
  readonly status: number
  readonly url: string

  constructor(url: string, status: number, body: string) {
    super(`polymarket: ${url} responded ${String(status)}: ${body.slice(0, 300)}`)
    this.name = "PolymarketApiError"
    this.status = status
    this.url = url
  }
}

/** Raised when a paged read would exceed its safety bound. It throws rather
 *  than returning what it has: a silently truncated market list or fill history
 *  is indistinguishable from a complete one, and the caller acts on it. */
export class PolymarketPageLimitError extends Error {
  constructor(what: string, pages: number) {
    super(
      `polymarket: ${what} exceeded ${String(pages)} pages. Refusing to return a ` +
        "partial result — narrow the query or raise maxPages deliberately.",
    )
    this.name = "PolymarketPageLimitError"
  }
}

// ---------------------------------------------------------------------------
// Injection seams
// ---------------------------------------------------------------------------

/** The slice of `ClobClient` this adapter uses. Declared as an interface so a
 *  test can supply a book without a network, while production uses the real
 *  V2 client (constructed below). */
export interface ClobReader {
  getOrderBook(tokenId: string): Promise<OrderBookSummary>
  getVersion(): Promise<number>
}

/** A socket, reduced to what a book feed needs. Deliberately not the DOM
 *  `WebSocket` type: this shape is trivial to fake in a test, and the default
 *  factory adapts the real one. */
export interface VenueSocket {
  send(data: string): void
  close(): void
  addEventListener(type: string, listener: (event: { readonly data?: unknown }) => void): void
}

export type SocketFactory = (url: string) => VenueSocket

const defaultSocketFactory: SocketFactory = (url) => {
  const socket = new WebSocket(url)
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    addEventListener: (type, listener) => socket.addEventListener(type, listener as EventListener),
  }
}

export interface PolymarketReadOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly clob?: ClobReader
  readonly hosts?: Partial<PolymarketHosts>
  readonly now?: () => number
  readonly openSocket?: SocketFactory
  readonly sleep?: (ms: number) => Promise<void>
  /**
   * `listMarkets()` takes no arguments, but Polymarket has over 40,000 open
   * markets (verified: 400 Gamma pages did not exhaust `closed=false`), so
   * "every market" is not a list anyone can use or wait for. These bounds
   * define what the list *is*, and they are stated here rather than hidden in
   * a page cap so the definition is visible and adjustable.
   */
  readonly listMarkets?: {
    /** Open markets need this much resting liquidity in USD. Default 25,000
     *  yields 5,170 markets in 52 pages / ~10s — verified. */
    readonly minLiquidityUsd?: number
    /** Closed markets carry no liquidity (verified: `liquidityNum` is 0 or
     *  absent once the book is torn down), so the closed pass filters on
     *  traded volume instead. Default 250,000. */
    readonly minVolumeUsd?: number
    /** How far back to include closed and resolved markets. A resolved market
     *  must stay visible long enough for the reconciler to see that a position
     *  ended by settlement rather than by drift (docs/03 §5). Default 7 days. */
    readonly closedLookbackMs?: number
    /** Hard bound; exceeding it throws rather than truncating. */
    readonly maxPages?: number
  }
  readonly fills?: {
    /** Bound on `getFills` paging. 200 pages is 100,000 trades. */
    readonly maxPages?: number
    /** `watchFills` poll interval. The Data API caches for ~6s (verified:
     *  `cache-control: public, max-age=6`), so polling faster buys nothing. */
    readonly pollIntervalMs?: number
  }
  readonly book?: {
    /** Consecutive socket failures with no message in between before
     *  `watchBook` gives up and throws. Never retries forever in silence. */
    readonly maxReconnects?: number
  }
}

/** The half of `VenueAdapter` this wave implements. Typed as a `Pick` so the
 *  compiler, not review, proves the signatures still match the contract. */
export type PolymarketRead = Pick<
  VenueAdapter,
  | "listMarkets"
  | "getBook"
  | "getPositions"
  | "getAccountValue"
  | "getFills"
  | "watchFills"
  | "watchBook"
  | "constraints"
  | "quantize"
  | "rateBudget"
>

// ---------------------------------------------------------------------------
// Parsing venue values
// ---------------------------------------------------------------------------

/**
 * Turns a venue-supplied JSON value into a `Decimal`.
 *
 * The CLOB sends money as strings (`"0.001"`); the Data API sends it as JSON
 * *numbers* (`"size":48332.4875`, `"price":0.6299999989` — both verified). By
 * the time a reviver could see them they are already doubles, so the question
 * is not whether to avoid a float — the venue chose one — but how to capture it
 * without adding error of our own.
 *
 * `String(n)` is the shortest decimal that round-trips that exact double, so
 * this recovers the venue's own value and nothing is rounded. It is the
 * *opposite* of `parseFloat`: no float is ever produced here, and no arithmetic
 * touches the value before it becomes a bigint mantissa.
 */
const toDecimal = (value: unknown, field: string): Decimal => {
  if (typeof value === "string") return money.parse(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`polymarket: ${field} is not finite: ${String(value)}`)
    }
    return money.parse(String(value))
  }
  throw new TypeError(`polymarket: ${field} must be a string or number, got ${typeof value}`)
}

const ZERO: Decimal = money.parse("0")

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value === "") {
    throw new TypeError(`polymarket: ${field} must be a non-empty string`)
  }
  return value
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** Gamma encodes its arrays as JSON *inside* a JSON string: `outcomes` arrives
 *  as `"[\"Yes\", \"No\"]"`. Verified on every market sampled. */
const parseEmbeddedArray = (raw: unknown, field: string): readonly string[] => {
  if (Array.isArray(raw)) return raw.map((x) => String(x))
  if (typeof raw !== "string" || raw === "") return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new TypeError(`polymarket: ${field} is not JSON: ${raw.slice(0, 80)}`)
  }
  if (!Array.isArray(parsed)) throw new TypeError(`polymarket: ${field} is not an array`)
  return parsed.map((x) => String(x))
}

/** Gamma dates are ISO 8601; `endDate` is absent on 139 of 500 open markets
 *  (verified), which is why `Market.resolvesAt` is nullable. */
const toTimestamp = (iso: unknown): Timestamp | null => {
  if (typeof iso !== "string" || iso === "") return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : asTimestamp(ms)
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * `resolved` is not a synonym for `closed`, and the difference is the whole
 * reason this function exists (docs/03 §5). A closed market has stopped
 * trading; a resolved one has *settled*, so a position in it ended by payout
 * rather than by anyone selling. A reconciler that conflates the two sees
 * settlement as drift and tries to trade it back.
 *
 * Verified shapes:
 *   open      closed=false, acceptingOrders=true
 *   closed    closed=true,  umaResolutionStatus not yet "resolved"
 *   resolved  closed=true,  umaResolutionStatus="resolved",
 *             outcomePrices=["1","0"], acceptingOrders=false
 */
export const gammaMarketStatus = (m: Record<string, unknown>): MarketStatus => {
  if (m["umaResolutionStatus"] === "resolved") return "resolved"
  if (m["closed"] === true) return "closed"
  // Listed but not currently tradeable: the book is paused, not settled.
  if (m["archived"] === true || m["active"] === false) return "halted"
  if (m["acceptingOrders"] === false || m["enableOrderBook"] === false) return "halted"
  return "open"
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const createPolymarketRead = (options: PolymarketReadOptions = {}): PolymarketRead => {
  const hosts: PolymarketHosts = { ...POLYMARKET_HOSTS, ...options.hosts }
  const doFetch = options.fetch ?? globalThis.fetch
  const now = options.now ?? Date.now
  const openSocket = options.openSocket ?? defaultSocketFactory
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const clob: ClobReader =
    options.clob ?? new ClobClient({ host: hosts.clob, chain: Chain.POLYGON })

  const minLiquidityUsd = options.listMarkets?.minLiquidityUsd ?? 25_000
  const minVolumeUsd = options.listMarkets?.minVolumeUsd ?? 250_000
  const closedLookbackMs = options.listMarkets?.closedLookbackMs ?? 7 * 24 * 60 * 60 * 1000
  const marketMaxPages = options.listMarkets?.maxPages ?? 400
  const fillsMaxPages = options.fills?.maxPages ?? 200
  const pollIntervalMs = options.fills?.pollIntervalMs ?? 6_000
  const maxReconnects = options.book?.maxReconnects ?? 8

  /**
   * Per-market tick and share floor, learned from whichever surface reported
   * them first. `constraints()` and `quantize()` are synchronous by contract,
   * so they cannot fetch; this is how a real tick reaches them.
   *
   * Never evicted. It is keyed by market, not by call, so its size is bounded
   * by how many markets have been read — and dropping an entry would silently
   * revert that market to the default tick, which is the exact bug the cache
   * exists to prevent.
   */
  const rules = new Map<string, PolymarketMarketRules>()

  const rememberRules = (
    marketId: string,
    tick: Decimal | null,
    minShares: Decimal | null,
  ): void => {
    const current = rules.get(marketId) ?? DEFAULT_MARKET_RULES
    rules.set(marketId, {
      priceTick: tick ?? current.priceTick,
      minOrderShares: minShares ?? current.minOrderShares,
    })
  }

  const rulesFor = (marketId: MarketId): PolymarketMarketRules =>
    rules.get(marketId) ?? DEFAULT_MARKET_RULES

  // -- HTTP ----------------------------------------------------------------

  const getJson = async (url: string): Promise<unknown> => {
    const response = await doFetch(url, { headers: { accept: "application/json" } })
    if (!response.ok) {
      throw new PolymarketApiError(url, response.status, await response.text().catch(() => ""))
    }
    return response.json()
  }

  const query = (params: Record<string, string | number | undefined>): string => {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.set(key, String(value))
    }
    return search.toString()
  }

  // -- listMarkets ---------------------------------------------------------

  /**
   * Pages Gamma's keyset endpoint.
   *
   * `/markets` (offset-paged) still works but answers with
   * `deprecation: true` and `warning: 299 - "use /markets/keyset"` — verified
   * in the response headers. The cursor parameter is `after_cursor`; the
   * response field is `next_cursor`, and passing it back under its own name
   * silently re-serves page one (verified — a trap worth stating, because the
   * symptom is an infinite loop over identical rows, not an error).
   */
  const gammaPage = async (
    params: Record<string, string | number | undefined>,
    what: string,
  ): Promise<readonly Record<string, unknown>[]> => {
    const collected: Record<string, unknown>[] = []
    let cursor: string | undefined
    for (let page = 0; page < marketMaxPages; page++) {
      const url = `${hosts.gamma}/markets/keyset?${query({ ...params, limit: GAMMA_PAGE, after_cursor: cursor })}`
      const body = await getJson(url)
      if (!isRecord(body)) throw new TypeError(`polymarket: ${what} returned a non-object`)
      const markets = body["markets"]
      const rows = Array.isArray(markets) ? markets.filter(isRecord) : []
      collected.push(...rows)
      const next = body["next_cursor"]
      cursor = typeof next === "string" && next !== "" ? next : undefined
      if (cursor === undefined || rows.length === 0) return collected
    }
    throw new PolymarketPageLimitError(what, marketMaxPages)
  }

  /**
   * One Gamma market becomes one `Market` per outcome, because a `MarketId` is
   * a CLOB token id and therefore names an outcome. A binary question is two
   * entries — which is what makes `supportsShort: false` honest rather than a
   * limitation being papered over.
   */
  const toMarkets = (m: Record<string, unknown>): readonly Market[] => {
    const tokenIds = parseEmbeddedArray(m["clobTokenIds"], "clobTokenIds")
    const outcomes = parseEmbeddedArray(m["outcomes"], "outcomes")
    if (tokenIds.length === 0) return []

    const status = gammaMarketStatus(m)
    const resolvesAt = toTimestamp(m["endDate"])
    const slug = typeof m["slug"] === "string" && m["slug"] !== "" ? m["slug"] : String(m["id"] ?? "")
    const tick = m["orderPriceMinTickSize"] === undefined
      ? null
      : toDecimal(m["orderPriceMinTickSize"], "orderPriceMinTickSize")
    const minShares =
      m["orderMinSize"] === undefined ? null : toDecimal(m["orderMinSize"], "orderMinSize")

    return tokenIds.map((tokenId, index) => {
      rememberRules(tokenId, tick, minShares)
      const outcome = outcomes[index] ?? `outcome${String(index)}`
      return {
        id: asMarketId(tokenId),
        venue: "polymarket" as const,
        symbol: `${slug} (${outcome})`,
        kind: "binary-outcome" as const,
        status,
        resolvesAt,
        constraints: polymarketConstraints(rulesFor(asMarketId(tokenId))),
      }
    })
  }

  const listMarkets = async (): Promise<readonly Market[]> => {
    const closedSince = new Date(now() - closedLookbackMs).toISOString()

    const open = await gammaPage(
      { closed: "false", archived: "false", liquidity_num_min: minLiquidityUsd },
      "listMarkets (open)",
    )
    // Second pass so `resolved` is reachable at all. Without it a settled
    // market simply vanishes from the listing, and "gone" reads the same as
    // "delisted" to the caller that needed to tell settlement from drift.
    const settled = await gammaPage(
      {
        closed: "true",
        archived: "false",
        volume_num_min: minVolumeUsd,
        end_date_min: closedSince,
      },
      "listMarkets (closed)",
    )

    const byId = new Map<string, Market>()
    for (const row of [...open, ...settled]) {
      for (const market of toMarkets(row)) byId.set(market.id, market)
    }
    return [...byId.values()]
  }

  // -- getBook -------------------------------------------------------------

  /**
   * The CLOB returns both sides ordered *worst price first*: bids ascend
   * (0.001, 0.002, … best last) and asks descend (0.999, 0.998, … best last).
   * Verified twice on live books, over both REST and the socket. Taking the
   * head of either array as "the top of the book" reads the least attractive
   * level in the market as the touch — a silent, plausible-looking wrong
   * answer — so both sides are sorted explicitly here rather than reversed.
   */
  const toLevels = (raw: unknown, side: "bids" | "asks"): readonly BookLevel[] => {
    const rows = Array.isArray(raw) ? raw : []
    const levels = rows.filter(isRecord).map((row) => ({
      price: toDecimal(row["price"], `${side}.price`),
      size: toDecimal(row["size"], `${side}.size`),
    }))
    const direction = side === "bids" ? -1 : 1
    return levels.sort((a, b) => direction * money.cmp(a.price, b.price))
  }

  const getBook = async (marketId: MarketId, depth: number): Promise<Book> => {
    if (!Number.isInteger(depth) || depth <= 0) {
      throw new RangeError(`polymarket.getBook: depth must be a positive integer, got ${String(depth)}`)
    }
    const summary = await clob.getOrderBook(marketId)
    if (!isRecord(summary)) throw new TypeError("polymarket.getBook: CLOB returned a non-object")

    // The book carries the market's real tick and share floor; record them so
    // the synchronous constraints()/quantize() pair stops guessing.
    rememberRules(
      marketId,
      summary["tick_size"] === undefined ? null : toDecimal(summary["tick_size"], "tick_size"),
      summary["min_order_size"] === undefined
        ? null
        : toDecimal(summary["min_order_size"], "min_order_size"),
    )

    const assetId = summary["asset_id"]
    if (typeof assetId === "string" && assetId !== "" && assetId !== String(marketId)) {
      throw new TypeError(
        `polymarket.getBook: asked for ${String(marketId)} and the CLOB answered for ${assetId}`,
      )
    }

    const stamp = summary["timestamp"]
    const ts =
      typeof stamp === "string" && /^\d+$/.test(stamp) ? Number(stamp) : typeof stamp === "number" ? stamp : now()

    return {
      marketId,
      // Full depth, truncated only by what the caller asked for. The
      // book-depth gate cannot see how thin a market is from a touch summary,
      // and thin is the normal case outside headline markets (docs/02 §3).
      bids: toLevels(summary["bids"], "bids").slice(0, depth),
      asks: toLevels(summary["asks"], "asks").slice(0, depth),
      ts: asTimestamp(ts),
    }
  }

  // -- positions and portfolio value ---------------------------------------

  /**
   * Keyed by the **proxy / deposit wallet**, never by the signer.
   *
   * Signer, owner and funder are three different addresses on Polymarket. The
   * Data API indexes on-chain token balances, which sit in the proxy wallet, so
   * passing a signer address returns `[]` for a fully funded account — an empty
   * portfolio that looks exactly like an API outage rather than a wrong key.
   */
  const getPositions = async (address: Address): Promise<readonly Position[]> => {
    const positions: Position[] = []
    for (let page = 0; page < fillsMaxPages; page++) {
      const url = `${hosts.dataApi}/positions?${query({
        user: address,
        limit: DATA_POSITIONS_PAGE,
        offset: page * DATA_POSITIONS_PAGE,
        // Explicit: the endpoint's own default threshold would drop dust
        // positions, and a position we cannot see is a position we cannot
        // reconcile.
        sizeThreshold: 0,
      })}`
      const rows = await getJson(url)
      if (!Array.isArray(rows)) throw new TypeError("polymarket.getPositions: expected an array")

      for (const row of rows) {
        if (!isRecord(row)) continue
        const size = toDecimal(row["size"], "position.size")
        if (money.isZero(size)) continue
        positions.push({
          venue: "polymarket",
          marketId: asMarketId(requireString(row["asset"], "position.asset")),
          // Always long. Holding an outcome token is the only position that
          // exists here; the bearish expression is holding the other token,
          // which is a different MarketId.
          side: "long",
          size: money.abs(size),
          entryPrice: toDecimal(row["avgPrice"], "position.avgPrice"),
          // The venue's own mark value (size x curPrice), taken as reported
          // rather than recomputed so it agrees with what the account holder
          // sees on polymarket.com.
          notional: toDecimal(row["currentValue"], "position.currentValue"),
          // `cashPnl` is exactly currentValue - initialValue (verified against
          // the payload arithmetic), i.e. the unrealised move on the shares
          // still held. `realizedPnl` is reported separately and belongs to
          // closed size, so it is deliberately not added in here.
          unrealizedPnl: toDecimal(row["cashPnl"], "position.cashPnl"),
          leverage: null,
          liquidationPrice: null,
        })
      }
      if (rows.length < DATA_POSITIONS_PAGE) return positions
    }
    throw new PolymarketPageLimitError("getPositions", fillsMaxPages)
  }

  /**
   * The mark value of open positions.
   *
   * Verified against four live wallets: `/value` equals the sum of every
   * position's `currentValue` to within the endpoint's own rounding
   * (10.3967 vs 10.3966, 136.0499 vs 136.0497, 0.0083 vs 0.0083, 0 vs 0). It
   * therefore does **not** include idle USDC — a wallet holding only cash
   * reports zero here. Cash balance needs the CLOB's authenticated
   * `/balance-allowance`, which is W10's surface, not a public read.
   */
  const getAccountValue = async (address: Address): Promise<Decimal> => {
    const rows = await getJson(`${hosts.dataApi}/value?${query({ user: address })}`)
    if (!Array.isArray(rows)) throw new TypeError("polymarket.getAccountValue: expected an array")
    const wanted = String(address).toLowerCase()
    for (const row of rows) {
      if (!isRecord(row)) continue
      const user = row["user"]
      if (typeof user === "string" && user.toLowerCase() !== wanted) continue
      return toDecimal(row["value"], "value")
    }
    // No row is a real answer: an address with no positions has no value.
    return ZERO
  }

  // -- fills ---------------------------------------------------------------

  /**
   * The Data API's trade feed has no trade id, so one is derived.
   *
   * `venue_fill_id` is UNIQUE in the database, which is what makes replayed
   * history a no-op — but it also means two fills that hash the same silently
   * become one. Transaction hash plus outcome, side, price and size was unique
   * across 500 consecutive trades of a heavy account (verified), and a single
   * transaction did contain two distinct trades, which those fields separate.
   * The residual collision is two fills of identical size and price against
   * different makers inside one transaction: indistinguishable in this payload,
   * and it would be undercounted. The CLOB's authenticated `/data/trades` does
   * return real trade ids and is the fix, once W10 lands credentials.
   */
  const fillId = (row: Record<string, unknown>): VenueFillId =>
    [
      requireString(row["transactionHash"], "trade.transactionHash"),
      requireString(row["asset"], "trade.asset"),
      String(row["side"] ?? ""),
      String(row["price"] ?? ""),
      String(row["size"] ?? ""),
    ].join(":") as VenueFillId

  const toSide = (raw: unknown): OrderSide => {
    const side = String(raw).toUpperCase()
    if (side === "BUY") return "buy"
    if (side === "SELL") return "sell"
    throw new TypeError(`polymarket: unknown trade side ${String(raw)}`)
  }

  const toFill = (row: Record<string, unknown>): Fill => ({
    id: fillId(row),
    venue: "polymarket",
    address: asAddress(requireString(row["proxyWallet"], "trade.proxyWallet")),
    marketId: asMarketId(requireString(row["asset"], "trade.asset")),
    side: toSide(row["side"]),
    price: toDecimal(row["price"], "trade.price"),
    size: toDecimal(row["size"], "trade.size"),
    // The public trade feed carries no fee field at all — verified against the
    // full key set. Fees are real (positions report `entryFeesUsdc`), so this
    // zero is a gap, not a fact: PnL derived from these fills is gross of fees
    // until the authenticated CLOB trade feed is wired up.
    fee: ZERO,
    // Data API trade timestamps are epoch *seconds*; Timestamp is milliseconds.
    ts: asTimestamp(tradeSeconds(row) * 1000),
    // Not reported per trade on this surface. Modelled as unknown rather than
    // as zero, which would read as "this fill closed nothing".
    closedPnl: null,
  })

  const tradeSeconds = (row: Record<string, unknown>): number => {
    const raw = row["timestamp"]
    const seconds = typeof raw === "number" ? raw : Number(raw)
    if (!Number.isFinite(seconds)) {
      throw new TypeError(`polymarket: trade.timestamp is not a number: ${String(raw)}`)
    }
    return seconds
  }

  /**
   * Newest-first paging back to `since`.
   *
   * The endpoint ignores every time-filter parameter tried — `from`, `startTs`,
   * `start`, `after`, `min_timestamp` all return the newest trades regardless
   * (verified) — so the window is applied client-side and paging stops at the
   * first page that reaches past `since`.
   */
  const getFills = async (address: Address, since: Timestamp): Promise<readonly Fill[]> => {
    const fills: Fill[] = []
    for (let page = 0; page < fillsMaxPages; page++) {
      const url = `${hosts.dataApi}/trades?${query({
        user: address,
        limit: DATA_TRADES_PAGE,
        offset: page * DATA_TRADES_PAGE,
        takerOnly: "false",
      })}`
      const rows = await getJson(url)
      if (!Array.isArray(rows)) throw new TypeError("polymarket.getFills: expected an array")

      let reachedPast = false
      for (const row of rows) {
        if (!isRecord(row)) continue
        const fill = toFill(row)
        if (fill.ts < since) {
          reachedPast = true
          continue
        }
        fills.push(fill)
      }
      if (reachedPast || rows.length < DATA_TRADES_PAGE) return fills
    }
    throw new PolymarketPageLimitError("getFills", fillsMaxPages)
  }

  /**
   * Polls the public trade feed per address.
   *
   * The brief maps this to the CLOB's `user` socket channel, and that channel
   * cannot do this job: it authenticates with one account's L2 credentials and
   * streams only that account's own fills. Connecting without credentials is
   * closed with `1008 authentication failed` (verified), and there is no
   * subscribe field for "somebody else's address" — `markets` filters by
   * condition id, not by user. `watchFills` takes a list of arbitrary
   * addresses and no credentials, and the addresses we care about are leaders'
   * wallets, whose credentials we will never hold. Polling the public feed is
   * the only shape that satisfies the signature. Flagged, not hidden.
   *
   * The first poll per address is a **seed, not a burst of fills** — the same
   * rule the interface states for Hyperliquid's snapshot. Emitting it would
   * replay a leader's entire recent history as if it had just happened, every
   * time the process restarts. Backfill belongs to `getFills`.
   */
  async function* watchFills(addresses: readonly Address[]): AsyncIterable<Fill> {
    if (addresses.length === 0) return
    const seen = new Map<Address, Set<string>>()

    for (;;) {
      for (const address of addresses) {
        const url = `${hosts.dataApi}/trades?${query({
          user: address,
          limit: DATA_TRADES_PAGE,
          takerOnly: "false",
        })}`
        const rows = await getJson(url)
        if (!Array.isArray(rows)) continue

        const known = seen.get(address)
        const fresh = new Set<string>()
        const emit: Fill[] = []
        for (const row of rows) {
          if (!isRecord(row)) continue
          const fill = toFill(row)
          fresh.add(fill.id)
          if (known !== undefined && !known.has(fill.id)) emit.push(fill)
        }
        seen.set(address, fresh)

        // Oldest first, so a consumer sees them in the order they happened.
        for (const fill of emit.sort((a, b) => a.ts - b.ts)) yield fill
      }
      await sleep(pollIntervalMs)
    }
  }

  // -- book stream ---------------------------------------------------------

  /**
   * `market` channel, subscribed by token id.
   *
   * Two shapes arrive. The first message is a JSON *array* of `book` events,
   * one per subscribed asset — a full snapshot, and a state reset on every
   * reconnect. After that, `price_change` events carry one or more changed
   * levels, where `size: "0"` means the level is gone.
   *
   * The channel subscribes by *market*, not by token: asking for one outcome
   * also delivers changes for its sibling outcome (verified — subscribing to
   * the YES token produced NO-token changes in the same message). Every event
   * is therefore filtered back down to the ids the caller actually asked for.
   */
  async function* watchBook(marketIds: readonly MarketId[]): AsyncIterable<BookDelta> {
    if (marketIds.length === 0) return
    const wanted = new Set(marketIds.map((id) => String(id)))
    let failures = 0

    for (;;) {
      const queue = createQueue<BookDelta>()
      const socket = openSocket(hosts.wsMarket)
      let delivered = false

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ assets_ids: [...wanted], type: "market" }))
      })
      socket.addEventListener("message", (event) => {
        for (const delta of decodeBookEvents(event.data, wanted, now)) {
          delivered = true
          queue.push(delta)
        }
      })
      socket.addEventListener("close", () => queue.close())
      socket.addEventListener("error", () => queue.close())

      try {
        for await (const delta of queue) yield delta
      } finally {
        socket.close()
      }

      // A connection that delivered something and then dropped is normal; one
      // that never delivered anything is a broken feed, and retrying it
      // forever in silence is how a dead subscription looks healthy.
      failures = delivered ? 0 : failures + 1
      if (failures >= maxReconnects) {
        throw new Error(
          `polymarket.watchBook: ${String(failures)} consecutive connections to ${hosts.wsMarket} ` +
            "produced no data",
        )
      }
      await sleep(Math.min(250 * 2 ** failures, 8_000))
    }
  }

  const decodeBookEvents = (
    raw: unknown,
    wanted: ReadonlySet<string>,
    clock: () => number,
  ): readonly BookDelta[] => {
    if (typeof raw !== "string" || raw === "") return []
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
    const events = Array.isArray(parsed) ? parsed : [parsed]
    const out: BookDelta[] = []

    for (const event of events) {
      if (!isRecord(event)) continue
      const stamp = Number(event["timestamp"])
      const ts = asTimestamp(Number.isFinite(stamp) ? stamp : clock())

      if (event["event_type"] === "book" || Array.isArray(event["bids"])) {
        const assetId = String(event["asset_id"] ?? "")
        if (!wanted.has(assetId)) continue
        out.push({
          marketId: asMarketId(assetId),
          bids: toLevels(event["bids"], "bids"),
          asks: toLevels(event["asks"], "asks"),
          ts,
          isSnapshot: true,
        })
        continue
      }

      if (event["event_type"] === "price_change" && Array.isArray(event["price_changes"])) {
        // One event can touch several assets; group so each yields one delta.
        const grouped = new Map<string, { bids: BookLevel[]; asks: BookLevel[] }>()
        for (const change of event["price_changes"]) {
          if (!isRecord(change)) continue
          const assetId = String(change["asset_id"] ?? "")
          if (!wanted.has(assetId)) continue
          const bucket = grouped.get(assetId) ?? { bids: [], asks: [] }
          const level: BookLevel = {
            price: toDecimal(change["price"], "price_change.price"),
            // size 0 is a removal, carried through as a zero level so the
            // consumer applies it rather than having to infer the deletion.
            size: toDecimal(change["size"], "price_change.size"),
          }
          if (String(change["side"]).toUpperCase() === "BUY") bucket.bids.push(level)
          else bucket.asks.push(level)
          grouped.set(assetId, bucket)
        }
        for (const [assetId, bucket] of grouped) {
          out.push({
            marketId: asMarketId(assetId),
            bids: bucket.bids,
            asks: bucket.asks,
            ts,
            isSnapshot: false,
          })
        }
      }
    }
    return out
  }

  // -- venue rules ---------------------------------------------------------

  const constraints = (marketId: MarketId): MarketConstraints =>
    polymarketConstraints(rulesFor(marketId))

  const quantize = (
    marketId: MarketId,
    side: OrderSide,
    price: Decimal | null,
    size: Decimal,
  ): QuantizedOrder => quantizePolymarketOrder(side, price, size, rulesFor(marketId))

  /**
   * Polymarket has no per-address action budget.
   *
   * Hyperliquid meters actions per address (one request per USDC of lifetime
   * volume), which is what this method exists for. Polymarket's limits are
   * per-IP on the CLOB, and none of the four hosts returns a rate-limit header
   * of any kind — verified on Gamma, CLOB and the Data API responses. There is
   * nothing address-scoped to report and no way to measure what is left, so
   * this says "unbounded" rather than inventing a number that a UI meter would
   * then present as measured fact.
   */
  const rateBudget = (_address: Address): Promise<{ remaining: number; resetsAt: Timestamp | null }> =>
    Promise.resolve({ remaining: Number.POSITIVE_INFINITY, resetsAt: null })

  return {
    listMarkets,
    getBook,
    getPositions,
    getAccountValue,
    getFills,
    watchFills,
    watchBook,
    constraints,
    quantize,
    rateBudget,
  }
}

// ---------------------------------------------------------------------------
// A queue that turns socket callbacks into an async iterable
// ---------------------------------------------------------------------------

interface Queue<T> extends AsyncIterable<T> {
  push(value: T): void
  close(): void
}

/** Buffers what the socket pushes and hands it to a consumer that may be
 *  slower. Closing ends the iteration cleanly rather than hanging the
 *  generator that is awaiting the next value. */
const createQueue = <T>(): Queue<T> => {
  const buffer: T[] = []
  let closed = false
  let wake: (() => void) | null = null

  const signal = (): void => {
    const resume = wake
    wake = null
    resume?.()
  }

  return {
    push(value: T) {
      if (closed) return
      buffer.push(value)
      signal()
    },
    close() {
      closed = true
      signal()
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (buffer.length > 0) {
          // Drained one at a time so a consumer that stops early leaves the
          // rest in the buffer instead of losing it.
          yield buffer.shift() as T
        }
        if (closed) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
  }
}
