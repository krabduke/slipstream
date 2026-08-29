/**
 * Gate 5 — book_depth.
 *
 * Depth **inside the slippage band**, not total depth. A book with 400 lots
 * sitting three cents above our price limit is not liquidity we can use; it is
 * liquidity that would fill us at a price the slippage gate has already said we
 * will not pay. Summing the whole book here would silently undo gate 4.
 *
 * The band edge is the worst price this order could actually transact at:
 *   - the leader's fill worsened by the slippage tolerance, and/or
 *   - our own limit price, which we can never fill past,
 * whichever is tighter. With neither (a manual market order) it is the best
 * executable price worsened by the same tolerance.
 */
import { money } from "@slipstream/shared"
import type { Decimal, OrderSide, TradeIntent } from "@slipstream/shared"
import type { Gate, GateVerdict, RiskContext } from "../types.js"
import { OK, executablePrice, isPositive, notionalOf, reject, usableLevels } from "./shared.js"

/** Extra places so a coarse price scale cannot floor the whole tolerance away
 *  and collapse the band onto a single price. */
const BAND_EXTRA_SCALE = 4

/** Move `price` in the direction that hurts us, by `bps`. Rounded so the
 *  allowance is never larger than it should be: a narrower band counts less
 *  depth, which is the conservative direction. */
const worsen = (price: Decimal, bps: number, side: OrderSide): Decimal => {
  // `bpsOf` refuses a fractional bps rather than building a Decimal out of a
  // float, and a gate must not throw on a badly configured limit. Truncating
  // toward zero narrows the band, and an unusable limit collapses it onto the
  // reference price: both are the conservative direction, and the slippage
  // gate itself still compares against the exact configured number.
  const whole = Number.isSafeInteger(bps) ? bps : Number.isFinite(bps) ? Math.trunc(bps) : 0
  const allowance = money.bpsOf(price, whole, price.scale + BAND_EXTRA_SCALE, "floor")
  return side === "buy" ? money.add(price, allowance) : money.sub(price, allowance)
}

/** Buy: everything at or below the edge is reachable. Sell: at or above. */
const inBand = (levelPrice: Decimal, edge: Decimal, side: OrderSide): boolean =>
  side === "buy" ? money.lte(levelPrice, edge) : money.gte(levelPrice, edge)

/** The tighter of two edges — the one that admits less of the book. */
const tighter = (a: Decimal, b: Decimal, side: OrderSide): Decimal =>
  side === "buy" ? money.min(a, b) : money.max(a, b)

export const bookDepthGate: Gate = {
  name: "book_depth",
  evaluate(intent: TradeIntent, ctx: RiskContext): GateVerdict {
    const lookup = executablePrice(ctx, intent)
    if (!lookup.ok) return lookup.verdict
    const best = lookup.price
    const side = intent.side
    const bps = ctx.limits.maxSlippageBps

    const leader = intent.leaderRef
    const fromLeader =
      leader !== null && isPositive(leader.leaderFillPrice)
        ? worsen(leader.leaderFillPrice, bps, side)
        : null
    const fromLimit =
      intent.limitPrice !== null && isPositive(intent.limitPrice) ? intent.limitPrice : null

    const edge =
      fromLeader !== null && fromLimit !== null
        ? tighter(fromLeader, fromLimit, side)
        : (fromLeader ?? fromLimit ?? worsen(best, bps, side))

    const levels = usableLevels(ctx.book, side).filter((l) => inBand(l.price, edge, side))
    let depth = money.fromInt(0)
    for (const level of levels) depth = money.add(depth, level.size)

    // Exact by construction: the target scale is the product's own scale.
    const allowed = money.mul(
      depth,
      ctx.limits.maxBookPct,
      depth.scale + ctx.limits.maxBookPct.scale,
      "trunc",
    )
    if (money.gt(intent.size, allowed)) {
      return reject("book_too_thin", {
        orderSize: money.format(intent.size),
        depthInBand: money.format(depth),
        allowedSize: money.format(allowed),
        maxBookPct: money.format(ctx.limits.maxBookPct),
        levelsInBand: String(levels.length),
        bandEdge: money.format(edge),
        bestPrice: money.format(best),
        orderNotional: money.format(notionalOf(intent.size, best)),
        side,
      })
    }
    return OK
  },
}
