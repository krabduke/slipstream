/**
 * The paper executor's arithmetic (docs/03 §9). Pure: book in, fill out.
 *
 * Deliberately pessimistic — a simulation that flatters a leader manufactures
 * confidence for a live run, which is worse than no simulation:
 *  - it crosses the spread and walks the book level by level, so size moves
 *    the price exactly as it would live;
 *  - it only fills what the visible book holds, and never assumes hidden size;
 *  - it adds a latency penalty on top, because by the time a real order lands
 *    the book has moved against a copier (the leader's own trade moved it);
 *  - it charges the venue's taker fee.
 */
import { money } from "@slipstream/shared"
import type { Decimal, OrderSide } from "@slipstream/shared"
import type { Book, BookLevel } from "@slipstream/venues"

export interface PaperCosts {
  /** Adverse price adjustment applied to the average fill, in bps. */
  readonly latencyBps: number
  readonly takerFeeBps: number
}

export const PAPER_COSTS = {
  hyperliquid: { latencyBps: 3, takerFeeBps: 5 },
  // Thin books and chunky fills: a copier is typically well behind the
  // leader's price. Polymarket charges no taker fee on most markets.
  polymarket: { latencyBps: 50, takerFeeBps: 0 },
} as const satisfies Record<string, PaperCosts>

export interface PaperFill {
  readonly filledSize: Decimal
  readonly avgPrice: Decimal | null
  readonly fee: Decimal
}

const PRICE_SCALE = 10
const BPS = money.fromInt(10_000)

const sortedLevels = (book: Book, side: OrderSide): BookLevel[] =>
  [...(side === "buy" ? book.asks : book.bids)]
    .filter((l) => money.gt(l.size, money.fromInt(0)) && money.gt(l.price, money.fromInt(0)))
    .sort((a, b) => (side === "buy" ? money.cmp(a.price, b.price) : money.cmp(b.price, a.price)))

/** Walk the book for `size`. Partial when the visible book runs out. */
export function simulateFill(book: Book, side: OrderSide, size: Decimal, costs: PaperCosts): PaperFill {
  let remaining = size
  let filled = money.fromInt(0)
  let notional = money.fromInt(0)
  for (const level of sortedLevels(book, side)) {
    if (!money.gt(remaining, money.fromInt(0))) break
    const take = money.min(remaining, level.size)
    filled = money.add(filled, take)
    notional = money.add(notional, money.mul(take, level.price, PRICE_SCALE, "trunc"))
    remaining = money.sub(remaining, take)
  }
  if (money.isZero(filled)) return { filledSize: filled, avgPrice: null, fee: money.fromInt(0) }
  const raw = money.div(notional, filled, PRICE_SCALE, side === "buy" ? "ceil" : "floor")
  const penalty = money.div(money.fromInt(costs.latencyBps), BPS, PRICE_SCALE, "ceil")
  const avg = side === "buy"
    ? money.mul(raw, money.add(money.fromInt(1), penalty), PRICE_SCALE, "ceil")
    : money.mul(raw, money.sub(money.fromInt(1), penalty), PRICE_SCALE, "floor")
  const fee = money.div(money.mul(money.mul(filled, avg, PRICE_SCALE, "ceil"), money.fromInt(costs.takerFeeBps), PRICE_SCALE, "ceil"), BPS, PRICE_SCALE, "ceil")
  return { filledSize: filled, avgPrice: avg, fee }
}

export interface PaperPosition {
  readonly side: "long" | "short"
  readonly size: Decimal
  readonly entryPrice: Decimal
}

/**
 * Apply a fill to a position. Increasing averages the entry; reducing books
 * realised PnL at the fill price; crossing through zero closes the old side
 * in full and opens the remainder on the other side.
 */
export function applyFill(
  pos: PaperPosition | null,
  side: OrderSide,
  size: Decimal,
  price: Decimal,
): { position: PaperPosition | null; realizedPnl: Decimal } {
  const zero = money.fromInt(0)
  const incoming: "long" | "short" = side === "buy" ? "long" : "short"
  if (!pos || money.isZero(pos.size)) {
    return { position: { side: incoming, size, entryPrice: price }, realizedPnl: zero }
  }
  if (pos.side === incoming) {
    const total = money.add(pos.size, size)
    const cost = money.add(
      money.mul(pos.size, pos.entryPrice, PRICE_SCALE, "trunc"),
      money.mul(size, price, PRICE_SCALE, "trunc"),
    )
    return { position: { side: pos.side, size: total, entryPrice: money.div(cost, total, PRICE_SCALE, "trunc") }, realizedPnl: zero }
  }
  const closing = money.min(pos.size, size)
  const perUnit = pos.side === "long" ? money.sub(price, pos.entryPrice) : money.sub(pos.entryPrice, price)
  const realizedPnl = money.mul(closing, perUnit, PRICE_SCALE, "trunc")
  const left = money.sub(pos.size, closing)
  const beyond = money.sub(size, closing)
  if (money.gt(left, zero)) return { position: { ...pos, size: left }, realizedPnl }
  if (money.gt(beyond, zero)) return { position: { side: incoming, size: beyond, entryPrice: price }, realizedPnl }
  return { position: null, realizedPnl }
}
