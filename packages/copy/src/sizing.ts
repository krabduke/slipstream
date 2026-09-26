/**
 * Sizing modes (docs/03 §3): how big the follower's position should be, given
 * the leader's. Modes propose; the risk gate's caps dispose afterwards.
 *
 * Returns the desired follower size in base units (always >= 0; direction is
 * the caller's), or a failure when the inputs needed to size safely are
 * missing. A failure is a refusal, not a zero: the planner turns it into a
 * skip with the reason, and never opens or grows a position on a guess.
 */
import { money } from "@slipstream/shared"
import type { Decimal, SizingMode } from "@slipstream/shared"

/** Working precision for sizes before venue quantization (which rounds down). */
export const SIZE_SCALE = 10

export type SizingFailure = "leader_equity_unavailable" | "follower_equity_unavailable" | "price_unavailable"

export type SizingResult =
  | { readonly ok: true; readonly size: Decimal }
  | { readonly ok: false; readonly reason: SizingFailure }

const positive = (d: Decimal | null): d is Decimal => d !== null && money.gt(d, money.fromInt(0))

export function sizeFor(
  leaderSize: Decimal,
  sizing: SizingMode,
  leaderEquity: Decimal | null,
  followerEquity: Decimal | null,
  markPrice: Decimal | null,
): SizingResult {
  const abs = money.abs(leaderSize)
  if (money.isZero(abs)) return { ok: true, size: money.fromInt(0, SIZE_SCALE) }
  switch (sizing.mode) {
    case "equity_ratio": {
      // Fails closed: guessing a leader's equity to size a leveraged position
      // is not acceptable (docs/03 §3).
      if (!positive(leaderEquity)) return { ok: false, reason: "leader_equity_unavailable" }
      if (!positive(followerEquity)) return { ok: false, reason: "follower_equity_unavailable" }
      const ratio = money.div(followerEquity, leaderEquity, 18, "trunc")
      const scaled = money.mul(money.mul(abs, ratio, 18, "trunc"), sizing.multiplier, SIZE_SCALE, "trunc")
      return { ok: true, size: scaled }
    }
    case "fixed_notional": {
      if (!positive(markPrice)) return { ok: false, reason: "price_unavailable" }
      return { ok: true, size: money.div(sizing.notional, markPrice, SIZE_SCALE, "trunc") }
    }
    case "percent_equity": {
      if (!positive(followerEquity)) return { ok: false, reason: "follower_equity_unavailable" }
      if (!positive(markPrice)) return { ok: false, reason: "price_unavailable" }
      const notional = money.div(money.mul(followerEquity, sizing.percent, 18, "trunc"), money.fromInt(100), 18, "trunc")
      return { ok: true, size: money.div(notional, markPrice, SIZE_SCALE, "trunc") }
    }
    case "fixed_multiplier":
      return { ok: true, size: money.mul(abs, sizing.k, SIZE_SCALE, "trunc") }
  }
}
