/**
 * The target-state planner (docs/03 §2).
 *
 *   target   = sign(leader) x sizeFor(|leader|)      per market
 *   delta    = target - follower
 *
 * and then, per market:
 *   - follower holds a position the leader no longer holds, or holds it on the
 *     other side                     -> ExitIntent for the whole position
 *   - same side, target smaller      -> ExitIntent for the difference
 *   - target larger (incl. opening)  -> TradeIntent for the difference
 *   - |delta| inside the tolerance   -> nothing
 *
 * Exits never depend on sizing succeeding: a leader who closed is followed out
 * even when equity is unreadable. Only opening and increasing can fail closed.
 *
 * Pure: no I/O and no clock (time comes from ctx.now). Intent ids and
 * idempotency keys are derived from the inputs, so planning twice from the
 * same state yields the same keys and the database's UNIQUE constraint turns
 * the second attempt into a no-op.
 */
import { createHash } from "node:crypto"

import { money } from "@slipstream/shared"
import type {
  Decimal,
  ExitIntent,
  IdempotencyKey,
  IntentId,
  LeaderRef,
  MarketId,
  SkipDecision,
  Timestamp,
  TradeIntent,
} from "@slipstream/shared"
import type { Position } from "@slipstream/venues"

import { SIZE_SCALE, sizeFor } from "./sizing.js"
import type { Plan, PlanContext } from "./types.js"

/** How old a synthesized leader ref is made for a market with no known fill. */
export const STALE_REF_AGE_MS = 24 * 60 * 60 * 1000

const ZERO = money.fromInt(0, SIZE_SCALE)
const TWO_PERCENT = money.parse("0.02")

const signed = (p: Position | undefined): Decimal =>
  p === undefined ? ZERO : p.side === "long" ? p.size : money.neg(p.size)

const sign = (d: Decimal): -1 | 0 | 1 => money.cmp(d, money.fromInt(0))

const digest = (...parts: readonly string[]) => createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32)

/** Deterministic UUID-shaped id from a digest, so it fits uuid columns. */
const uuidFrom = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`

export function plan(ctx: PlanContext): Plan {
  const trades: TradeIntent[] = []
  const exits: ExitIntent[] = []
  const skips: SkipDecision[] = []

  const leaders = new Map(ctx.leaderPositions.map((p) => [p.marketId, p]))
  const followers = new Map(ctx.followerPositions.map((p) => [p.marketId, p]))
  const markets = new Set<MarketId>([...leaders.keys(), ...followers.keys()])

  for (const marketId of [...markets].sort()) {
    const L = signed(leaders.get(marketId))
    const F = signed(followers.get(marketId))
    const mark = ctx.markPrices.get(marketId) ?? null
    const leaderRef = refFor(ctx, marketId, leaders.get(marketId))

    const exit = (size: Decimal | null, reason: ExitIntent["reason"]): ExitIntent => {
      const key = digest(ctx.subscriptionId, marketId, "exit", reason, money.format(F), size ? money.format(size) : "all")
      return {
        kind: "exit",
        id: uuidFrom(key) as IntentId,
        userId: ctx.userId,
        subscriptionId: ctx.subscriptionId,
        venue: ctx.venue,
        marketId,
        size,
        reason,
        idempotencyKey: key as IdempotencyKey,
        createdAt: ctx.now,
      }
    }
    const skip = (reason: SkipDecision["reason"], detail: Record<string, string>): SkipDecision => ({
      kind: "skip",
      userId: ctx.userId,
      subscriptionId: ctx.subscriptionId,
      venue: ctx.venue,
      marketId,
      reason,
      detail,
      leaderRef,
      createdAt: ctx.now,
    })

    // 1. Leader is flat, or on the other side: get out, whatever else is true.
    if (!money.isZero(F) && (money.isZero(L) || sign(L) !== sign(F))) {
      exits.push(exit(null, money.isZero(L) ? "leader_closed" : "leader_reduced"))
    }
    if (money.isZero(L)) continue

    // 2. Size the target. Failure only ever blocks opening or growing.
    const sized = sizeFor(L, ctx.sizing, ctx.leaderEquity, ctx.followerEquity, mark)
    const sameSideF = sign(L) === sign(F) ? money.abs(F) : ZERO
    if (!sized.ok) {
      skips.push(
        skip(sized.reason === "price_unavailable" ? "market_not_open" : sized.reason, {
          leaderSize: money.format(L),
          sizingMode: ctx.sizing.mode,
        }),
      )
      continue
    }
    const target = sized.size

    // 3. Tolerance band: max(min notional, 2% of target), in base units.
    const diff = money.sub(target, sameSideF)
    const absDiff = money.abs(diff)
    const bandUnits =
      mark && money.gt(mark, money.fromInt(0)) ? money.div(ctx.toleranceBand, mark, SIZE_SCALE, "ceil") : ZERO
    const band = money.max(bandUnits, money.mul(target, TWO_PERCENT, SIZE_SCALE, "ceil"))
    if (money.lte(absDiff, band)) {
      if (!money.isZero(absDiff)) {
        skips.push(skip("below_tolerance_band", { delta: money.format(diff), band: money.format(band) }))
      }
      continue
    }

    if (money.isNegative(diff)) {
      // Same side, smaller: reduce. Ungated, like every exit.
      exits.push(exit(absDiff, "leader_reduced"))
      continue
    }

    // 4. Open or grow: a TradeIntent, which the risk gate will judge.
    const side = sign(L) > 0 ? "buy" : "sell"
    // The key includes the follower's current size: after a partial fill the
    // remainder is a new order and must get a new key, or the UNIQUE
    // constraint would silently swallow it.
    const key = digest(
      ctx.subscriptionId, marketId, "trade", side, money.format(target), money.format(F), String(leaderRef.leaderFillTs),
    )
    trades.push({
      kind: "trade",
      id: uuidFrom(key) as IntentId,
      userId: ctx.userId,
      subscriptionId: ctx.subscriptionId,
      venue: ctx.venue,
      marketId,
      side,
      size: absDiff,
      limitPrice: null,
      idempotencyKey: key as IdempotencyKey,
      leaderRef,
      createdAt: ctx.now,
    })
  }

  return { trades, exits, skips }
}

function refFor(ctx: PlanContext, marketId: MarketId, leaderPos: Position | undefined): LeaderRef {
  const known = ctx.leaderFills.get(marketId)
  if (known) return known
  // No fill seen for this market: the leader's position predates our watch.
  // Stamp the ref old enough that the signal-age gate refuses to chase it.
  return {
    leaderAddress: ctx.leaderAddress,
    leaderFillPrice: leaderPos?.entryPrice ?? money.fromInt(0),
    leaderFillTs: (ctx.now - STALE_REF_AGE_MS) as Timestamp,
  }
}
