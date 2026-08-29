/**
 * W14 — arithmetic and fail-closed helpers shared by the gates.
 *
 * Nothing here reads a clock, touches the network, or mutates its arguments.
 * Every money value goes through `money`; there is no `number` holding a price,
 * a size, or a notional anywhere in this package.
 */
import { money } from "@slipstream/shared"
import type { Decimal, OrderSide, ReasonCode, TradeIntent } from "@slipstream/shared"
import type { Book, BookLevel, Position } from "@slipstream/venues"
import type { GateVerdict, RiskContext } from "../types.js"

/** Ratios reported back to the user (leverage, consumption) — informational,
 *  derived from exact inputs that are also present in the detail map. */
export const RATIO_SCALE = 6

export const OK: GateVerdict = Object.freeze({ ok: true })

/** Every rejection carries the numbers that caused it. These strings are
 *  rendered straight into the activity feed, so they are the real values —
 *  `money.format` is canonical and round-trips through `money.parse`, unlike
 *  `money.display`, which is allowed to round for the eye. */
export const reject = (reason: ReasonCode, detail: Record<string, string>): GateVerdict =>
  Object.freeze({ ok: false, reason, detail: Object.freeze({ ...detail }) })

export const isPositive = (d: Decimal): boolean => !money.isZero(d) && !money.isNegative(d)

/** Exact: the target scale is the scale the product already has, so `mul`
 *  rounds nothing. The rounding mode is unreachable and only satisfies the
 *  signature. */
export const notionalOf = (size: Decimal, price: Decimal): Decimal =>
  money.mul(size, price, size.scale + price.scale, "trunc")

/** The side of the book this order has to cross. A buy lifts asks; a sell hits
 *  bids. */
export const crossedSide = (book: Book, side: OrderSide): readonly BookLevel[] =>
  side === "buy" ? book.asks : book.bids

/** Levels that are actually liquidity. A zero-size level is a stale echo and a
 *  non-positive price is not a tradable quote; counting either as depth is how
 *  a book-depth gate passes an order into an empty market. */
export const usableLevels = (book: Book, side: OrderSide): readonly BookLevel[] =>
  crossedSide(book, side).filter((l) => isPositive(l.size) && isPositive(l.price))

/** Best executable price, found by scanning rather than by trusting the book to
 *  be sorted. An adapter that returns levels in the wrong order would otherwise
 *  hand the slippage gate the *worst* price in the book and call it the best. */
export const bestPrice = (levels: readonly BookLevel[], side: OrderSide): Decimal | null => {
  let best: Decimal | null = null
  for (const level of levels) {
    best =
      best === null
        ? level.price
        : side === "buy"
          ? money.min(best, level.price)
          : money.max(best, level.price)
  }
  return best
}

export type PriceLookup =
  | { readonly ok: true; readonly price: Decimal }
  | { readonly ok: false; readonly verdict: GateVerdict }

/**
 * The price this order would transact at right now, or a rejection.
 *
 * Fails closed in both directions: a book belonging to another market and a
 * book with no usable level on the crossed side are both rejections, never an
 * assumed-safe pass. `book_too_thin` is the closest member of the closed reason
 * set for either — "there is no liquidity here we can use" is literally true of
 * both — and the detail map says which of the two actually happened.
 */
export const executablePrice = (ctx: RiskContext, intent: TradeIntent): PriceLookup => {
  if (ctx.book.marketId !== intent.marketId) {
    return {
      ok: false,
      verdict: reject("book_too_thin", {
        problem: "book_market_mismatch",
        intentMarketId: intent.marketId,
        bookMarketId: ctx.book.marketId,
        bookTs: String(ctx.book.ts),
      }),
    }
  }
  const levels = usableLevels(ctx.book, intent.side)
  const price = bestPrice(levels, intent.side)
  if (price === null) {
    return {
      ok: false,
      verdict: reject("book_too_thin", {
        problem: "no_usable_level_on_crossed_side",
        side: intent.side,
        crossedSide: intent.side === "buy" ? "asks" : "bids",
        usableLevels: "0",
        rawLevels: String(crossedSide(ctx.book, intent.side).length),
        bookTs: String(ctx.book.ts),
      }),
    }
  }
  return { ok: true, price }
}

export const positionInMarket = (ctx: RiskContext, intent: TradeIntent): Position | null =>
  ctx.followerPositions.find(
    (p) => p.venue === intent.venue && p.marketId === intent.marketId,
  ) ?? null

/** Direction lives in `side`; `size` is always positive (venues/types.ts). */
const signedPositionSize = (p: Position): Decimal =>
  p.side === "long" ? p.size : money.neg(p.size)

const signedOrderSize = (intent: TradeIntent): Decimal =>
  intent.side === "buy" ? intent.size : money.neg(intent.size)

/**
 * What this order does to the position in its own market, marked at `price`.
 *
 * Signed rather than additive, so a sell against an existing long nets down
 * instead of being counted as new risk. The planner only ever routes increases
 * here — a reduction is an `ExitIntent` and never reaches a gate (docs/03 §5) —
 * but a *manual* order (docs/03 §8) can legitimately be on the opposite side,
 * and a cap that treated it as an increase would block a user from reducing
 * their own position.
 */
export interface MarketDelta {
  readonly existingSize: Decimal
  readonly resultingSize: Decimal
  readonly existingNotional: Decimal
  readonly resultingNotional: Decimal
  /** Signed change in this market's notional: negative when netting down. */
  readonly exposureDelta: Decimal
}

export const marketDelta = (
  ctx: RiskContext,
  intent: TradeIntent,
  price: Decimal,
): MarketDelta => {
  const existing = positionInMarket(ctx, intent)
  // A zero at the order's own scale, so the detail map reads "0.0000" beside
  // "0.0200" rather than a bare "0" the user has to reconcile by eye.
  const existingSigned =
    existing === null ? money.fromBigInt(0n, intent.size.scale) : signedPositionSize(existing)
  const resultingSigned = money.add(existingSigned, signedOrderSize(intent))
  const existingSize = money.abs(existingSigned)
  const resultingSize = money.abs(resultingSigned)
  const existingNotional = notionalOf(existingSize, price)
  const resultingNotional = notionalOf(resultingSize, price)
  return {
    existingSize,
    resultingSize,
    existingNotional,
    resultingNotional,
    exposureDelta: money.sub(resultingNotional, existingNotional),
  }
}

/** Total exposure the account would carry if this order filled, marked at the
 *  same price the position cap used so the two gates can never disagree about
 *  what the order costs. */
export const resultingExposure = (ctx: RiskContext, delta: MarketDelta): Decimal =>
  money.add(ctx.currentExposure, delta.exposureDelta)

/**
 * Missing follower equity is a rejection, not an assumption.
 *
 * Every cap below `position_cap` is a fraction of equity. Treating an unknown
 * equity as "probably fine" sizes a leveraged position against a number nobody
 * has — docs/03 §3 makes the same call for the leader's equity, for the same
 * reason.
 */
export const requireEquity = (
  ctx: RiskContext,
): { readonly ok: true; readonly equity: Decimal } | { readonly ok: false; readonly verdict: GateVerdict } =>
  ctx.followerEquity === null
    ? {
        ok: false,
        verdict: reject("follower_equity_unavailable", {
          problem: "follower_equity_null",
          asOf: String(ctx.now),
        }),
      }
    : { ok: true, equity: ctx.followerEquity }

/** `a / b` for the detail map only — the gate's own comparison is always a
 *  multiplication, so nothing here can divide by zero on the deciding path.
 *  Returns null rather than inventing a ratio when the denominator is not a
 *  positive number: leverage against a zero or negative equity is not a number
 *  worth showing anyone. Rounded up so a violation is never understated. */
export const ratioOrNull = (a: Decimal, b: Decimal): string | null =>
  isPositive(b) ? money.format(money.div(a, b, RATIO_SCALE, "ceil")) : null
