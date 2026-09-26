/**
 * W6 — Hyperliquid reads, all against `POST https://api.hyperliquid.xyz/info`.
 *
 * Every function here takes its client as an argument rather than reaching for a
 * module-level singleton, so the whole read surface is testable against a fake
 * without a network and without a mocking framework.
 *
 * Two things this file is deliberate about:
 *
 *  - **No `parseFloat`, no `Number()`, anywhere on a value path.** Venue strings
 *    go straight into `money.parse`. The two JSON *numbers* Hyperliquid sends
 *    that carry a money-ish meaning (leverage) go through `fromJsonNumber`,
 *    which stringifies and parses rather than doing float arithmetic.
 *  - **Absent data throws; it never becomes an empty result.** `l2Book` answers
 *    `null` for a market that does not exist, and an empty book and a
 *    nonexistent market must not look the same to a depth gate.
 *
 * Request weights (the per-IP budget is 1200/minute and is shared across every
 * user on an engine instance): `l2Book` and `clearinghouseState` weigh 2,
 * `meta`, `spotMeta`, `userFillsByTime`, `extraAgents` and `userRateLimit` weigh
 * 20. `meta`/`spotMeta` are fetched once and cached; books and fills should come
 * over the WebSocket rather than from here in steady state.
 */
import { asAddress, asMarketId, asTimestamp, money } from "@slipstream/shared"
import type { Address, Decimal, MarketId, Timestamp, VenueFillId } from "@slipstream/shared"
import type { InfoClient } from "@nktkas/hyperliquid"
import type { MetaResponse, SpotMetaResponse, UserFillsResponse } from "@nktkas/hyperliquid/api/info"
import type { Book, BookLevel, DelegationProof, Fill, Market, Position } from "../types.js"
import { buildConstraints, type AssetSpec } from "./quantize.js"

/**
 * The slice of `InfoClient` this adapter uses. Narrowing it here means a test
 * fake implements seven methods instead of the full info surface, and adding an
 * eighth call site is a visible change to this type.
 */
export type HyperliquidInfo = Pick<
  InfoClient,
  | "meta"
  | "spotMeta"
  | "l2Book"
  | "clearinghouseState"
  | "userFillsByTime"
  | "extraAgents"
  | "userRateLimit"
>

/** `userFillsByTime` returns at most this many fills per call. */
export const FILLS_PAGE_LIMIT = 2000

/** Refuse to walk more than this many pages rather than looping on a hot address. */
export const FILLS_MAX_PAGES = 20

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/

/**
 * `Address` is branded but structurally a string, so it can carry anything a
 * caller cast into it. Validate at the boundary instead of forwarding garbage
 * to the venue and reading the rejection back as a mysterious 422.
 */
export const toHexAddress = (address: Address, what: string): `0x${string}` => {
  if (!HEX_ADDRESS.test(address)) {
    throw new TypeError(`hyperliquid.${what}: not a 20-byte hex address: ${JSON.stringify(address)}`)
  }
  return address.toLowerCase() as `0x${string}`
}

/**
 * Converts a JSON number the venue sends (leverage) into a `Decimal` without
 * float arithmetic: `String(n)` is the shortest round-tripping representation,
 * and `money.parse` reads it digit by digit from there.
 */
const fromJsonNumber = (n: number, what: string): Decimal => {
  if (!Number.isFinite(n)) {
    throw new RangeError(`hyperliquid.${what}: expected a finite number, got ${String(n)}`)
  }
  return money.parse(String(n))
}

/**
 * Markets, indexed by the id callers use. On Hyperliquid the `MarketId` *is* the
 * wire name (`BTC`, `@107`, `PURR/USDC`), which is what `/info` and the WS
 * channels accept, so no translation table is needed anywhere above this seam.
 */
export interface HyperliquidCatalog {
  readonly markets: readonly Market[]
  readonly specs: ReadonlyMap<string, AssetSpec>
  readonly fetchedAt: Timestamp
}

/** Pure: `meta` + `spotMeta` in, catalogue out. No I/O, so it is directly testable. */
export const buildCatalog = (
  meta: MetaResponse,
  spotMeta: SpotMetaResponse,
  fetchedAt: Timestamp,
): HyperliquidCatalog => {
  const specs = new Map<string, AssetSpec>()
  const markets: Market[] = []

  const add = (spec: AssetSpec): void => {
    const existing = specs.get(spec.marketId)
    if (existing !== undefined) {
      // Perp and spot names cannot collide today (spot names are `@n` or contain
      // a slash). If that ever changes, silently keeping one of them would give
      // two markets the same id in the database, so say so instead.
      throw new Error(
        `hyperliquid.listMarkets: duplicate market id ${spec.marketId} ` +
          `(${existing.kind} and ${spec.kind})`,
      )
    }
    specs.set(spec.marketId, spec)
    markets.push({
      id: spec.marketId,
      venue: "hyperliquid",
      symbol: spec.symbol,
      kind: spec.kind,
      status: spec.isDelisted ? "closed" : "open",
      // Perps and spot never settle on a clock; `resolved` is Polymarket's.
      resolvesAt: null,
      constraints: spec.constraints,
    })
  }

  for (const [i, asset] of meta.universe.entries()) {
    add({
      marketId: asMarketId(asset.name),
      coin: asset.name,
      symbol: asset.name,
      kind: "perp",
      assetIndex: i,
      szDecimals: asset.szDecimals,
      isDelisted: asset.isDelisted === true,
      constraints: buildConstraints("perp", asset.szDecimals, asset.maxLeverage),
    })
  }

  const tokensByIndex = new Map(spotMeta.tokens.map((token) => [token.index, token]))
  for (const pair of spotMeta.universe) {
    const [baseIndex, quoteIndex] = pair.tokens
    const base = tokensByIndex.get(baseIndex)
    const quote = tokensByIndex.get(quoteIndex)
    if (base === undefined || quote === undefined) {
      throw new Error(
        `hyperliquid.listMarkets: spot pair ${pair.name} references unknown token index ` +
          `${String(base === undefined ? baseIndex : quoteIndex)}`,
      )
    }
    add({
      marketId: asMarketId(pair.name),
      coin: pair.name,
      // `pair.name` is `@107` for most pairs, which is an id and not a label.
      symbol: pair.isCanonical ? pair.name : `${base.name}/${quote.name}`,
      kind: "spot",
      assetIndex: 10_000 + pair.index,
      // Size precision on a spot pair is the *base* token's.
      szDecimals: base.szDecimals,
      isDelisted: false,
      constraints: buildConstraints("spot", base.szDecimals, 1),
    })
  }

  return { markets, specs, fetchedAt }
}

export const fetchCatalog = async (info: HyperliquidInfo): Promise<HyperliquidCatalog> => {
  // Independent requests, weight 20 each; issue them together.
  const [meta, spotMeta] = await Promise.all([info.meta(), info.spotMeta()])
  return buildCatalog(meta, spotMeta, asTimestamp(Date.now()))
}

export const lookupSpec = (
  catalog: HyperliquidCatalog,
  marketId: MarketId,
  what: string,
): AssetSpec => {
  const spec = catalog.specs.get(marketId)
  if (spec === undefined) {
    throw new Error(`hyperliquid.${what}: unknown market ${JSON.stringify(marketId)}`)
  }
  return spec
}

export const toBookLevels = (
  levels: readonly { readonly px: string; readonly sz: string }[],
  depth: number,
): readonly BookLevel[] =>
  levels.slice(0, depth).map((level) => ({
    price: money.parse(level.px),
    size: money.parse(level.sz),
  }))

/**
 * L2 book snapshot.
 *
 * `depth` truncates; it cannot extend. Hyperliquid returns at most 20 levels per
 * side, so a caller asking for more gets 20 — read `bids.length` rather than
 * assuming the request was honoured.
 */
export const getBook = async (
  info: HyperliquidInfo,
  spec: AssetSpec,
  depth: number,
): Promise<Book> => {
  if (!Number.isInteger(depth) || depth <= 0) {
    throw new RangeError(`hyperliquid.getBook: depth must be a positive integer, got ${String(depth)}`)
  }
  // `nSigFigs: null` asks for the unaggregated book. Aggregating here would hide
  // exactly the thinness the book-depth gate exists to see.
  const book = await info.l2Book({ coin: spec.coin, nSigFigs: null })
  if (book === null) {
    throw new Error(
      `hyperliquid.getBook: no order book for ${spec.marketId} (coin ${spec.coin}) — ` +
        `the venue does not know this market`,
    )
  }
  const [bids, asks] = book.levels
  return {
    marketId: spec.marketId,
    bids: toBookLevels(bids, depth),
    asks: toBookLevels(asks, depth),
    ts: asTimestamp(book.time),
  }
}

/**
 * Open perp positions.
 *
 * `clearinghouseState` covers perps only; spot balances live behind
 * `spotClearinghouseState` and are not positions in this model.
 */
export const getPositions = async (
  info: HyperliquidInfo,
  address: Address,
): Promise<readonly Position[]> => {
  const state = await info.clearinghouseState({ user: toHexAddress(address, "getPositions") })
  const positions: Position[] = []
  for (const entry of state.assetPositions) {
    const raw = entry.position
    // `szi` is signed: the sign is the side, and the magnitude is the size.
    const signedSize = money.parse(raw.szi)
    if (money.isZero(signedSize)) continue
    positions.push({
      venue: "hyperliquid",
      marketId: asMarketId(raw.coin),
      side: money.isNegative(signedSize) ? "short" : "long",
      size: money.abs(signedSize),
      entryPrice: money.parse(raw.entryPx),
      notional: money.parse(raw.positionValue),
      unrealizedPnl: money.parse(raw.unrealizedPnl),
      leverage: fromJsonNumber(raw.leverage.value, "getPositions"),
      // Null on a position the venue cannot liquidate at any price.
      liquidationPrice: raw.liquidationPx === null ? null : money.parse(raw.liquidationPx),
    })
  }
  return positions
}

/**
 * Perps account value: collateral plus unrealised PnL, as the venue computes it.
 *
 * This is the perps clearinghouse only. A user holding spot inventory has value
 * that this number does not include.
 */
export const getAccountValue = async (
  info: HyperliquidInfo,
  address: Address,
): Promise<Decimal> => {
  const state = await info.clearinghouseState({ user: toHexAddress(address, "getAccountValue") })
  return money.parse(state.marginSummary.accountValue)
}

/**
 * `tid` is the venue's per-fill identifier and is what the database's
 * `venue_fill_id UNIQUE` constraint keys on. It is carried identically by the
 * REST backfill and the WS feed, which is what makes a replayed snapshot a no-op
 * rather than a duplicate.
 */
export const toFill = (raw: UserFillsResponse[number], address: Address): Fill => ({
  id: String(raw.tid) as VenueFillId,
  venue: "hyperliquid",
  address,
  marketId: asMarketId(raw.coin),
  side: raw.side === "B" ? "buy" : "sell",
  price: money.parse(raw.px),
  size: money.parse(raw.sz),
  // The builder fee is a second charge on the same fill; the cost of the fill is
  // both of them. It is absent on fills placed without a builder.
  fee:
    raw.builderFee === undefined
      ? money.parse(raw.fee)
      : money.add(money.parse(raw.fee), money.parse(raw.builderFee)),
  ts: asTimestamp(raw.time),
  closedPnl: money.parse(raw.closedPnl),
})

/**
 * Fills at or after `since`, oldest first.
 *
 * `userFillsByTime` caps each response at {@link FILLS_PAGE_LIMIT}, so a full
 * page is not "all the fills" — it is a truncation. This pages through until a
 * short page arrives, deduplicating by `tid` because the window restarts on the
 * last fill's timestamp and so re-reads any fills sharing that millisecond.
 *
 * Running out of pages throws. Returning a silently truncated history would
 * leave the copier permanently behind the leader with nothing in the logs.
 */
export const getFills = async (
  info: HyperliquidInfo,
  address: Address,
  since: Timestamp,
): Promise<readonly Fill[]> => {
  const user = toHexAddress(address, "getFills")
  if (!Number.isSafeInteger(since) || since < 0) {
    throw new RangeError(
      `hyperliquid.getFills: since must be epoch milliseconds, got ${String(since)}`,
    )
  }
  const owner = asAddress(address)
  const seen = new Set<number>()
  const fills: Fill[] = []
  let startTime: number = since

  for (let page = 0; page < FILLS_MAX_PAGES; page++) {
    const batch = await info.userFillsByTime({ user, startTime })
    for (const raw of batch) {
      if (seen.has(raw.tid)) continue
      seen.add(raw.tid)
      fills.push(toFill(raw, owner))
    }
    if (batch.length < FILLS_PAGE_LIMIT) return fills

    const last = batch[batch.length - 1]
    if (last === undefined) return fills
    if (last.time === startTime) {
      throw new Error(
        `hyperliquid.getFills: ${String(FILLS_PAGE_LIMIT)} or more fills share timestamp ` +
          `${String(startTime)} for ${owner}; the time window cannot advance`,
      )
    }
    startTime = last.time
  }

  throw new Error(
    `hyperliquid.getFills: more than ${String(FILLS_MAX_PAGES * FILLS_PAGE_LIMIT)} fills for ` +
      `${owner} since ${String(since)}; narrow the window rather than reading a truncated history`,
  )
}

/**
 * Remaining per-address action budget.
 *
 * `resetsAt` is `null` on purpose: Hyperliquid's per-address cap is not a
 * window that expires, it is one request per USDC of lifetime volume (after an
 * initial buffer). It refills by trading, not by waiting, so there is no honest
 * time to report.
 */
export const rateBudget = async (
  info: HyperliquidInfo,
  address: Address,
): Promise<{ remaining: number; resetsAt: Timestamp | null }> => {
  const limits = await info.userRateLimit({ user: toHexAddress(address, "rateBudget") })
  return {
    remaining: Math.max(0, limits.nRequestsCap - limits.nRequestsUsed),
    resetsAt: null,
  }
}

/**
 * Proves `signer` is a registered agent wallet of `owner`.
 *
 * Fails closed, and there is exactly one path that returns: a positive,
 * unexpired match in the owner's own agent list. A transport error, an empty
 * list, a self-delegation and an expired agent all throw — none of them is a
 * warning, because this runs *before* a key is written to storage and a
 * "probably fine" here is a key that can trade an account it was never granted.
 *
 * The security property being asserted is Hyperliquid's, not ours: an agent
 * wallet can place and cancel orders and cannot withdraw or transfer funds.
 * That is why `canWithdraw` is the literal `false`.
 */
export const verifyDelegation = async (
  info: HyperliquidInfo,
  owner: Address,
  signer: Address,
): Promise<DelegationProof> => {
  const ownerHex = toHexAddress(owner, "verifyDelegation")
  const signerHex = toHexAddress(signer, "verifyDelegation")
  if (ownerHex === signerHex) {
    throw new Error(
      `hyperliquid.verifyDelegation: signer ${signerHex} is the owner itself — that is a master ` +
        `key, not a delegated agent, and it can withdraw`,
    )
  }

  const agents = await info.extraAgents({ user: ownerHex })
  const match = agents.find((agent) => agent.address.toLowerCase() === signerHex)
  if (match === undefined) {
    throw new Error(
      `hyperliquid.verifyDelegation: ${signerHex} is not a registered agent of ${ownerHex} ` +
        `(${String(agents.length)} agent(s) listed)`,
    )
  }

  const verifiedAt = Date.now()
  if (match.validUntil !== null && match.validUntil <= verifiedAt) {
    throw new Error(
      `hyperliquid.verifyDelegation: agent ${signerHex} of ${ownerHex} expired at ` +
        `${new Date(match.validUntil).toISOString()}`,
    )
  }

  return {
    venue: "hyperliquid",
    owner: asAddress(ownerHex),
    signer: asAddress(signerHex),
    canWithdraw: false,
    verifiedAt: asTimestamp(verifiedAt),
    method:
      `hyperliquid /info extraAgents(user=${ownerHex}): ${signerHex} listed as agent ` +
      `"${match.name}" (validUntil ` +
      `${match.validUntil === null ? "none" : new Date(match.validUntil).toISOString()}); ` +
      `signer !== owner; Hyperliquid agent wallets can trade but cannot withdraw or transfer`,
  }
}
