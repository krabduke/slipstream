/**
 * The copy planner.
 *
 * Mirrors position STATE, not trade EVENTS. The leader's position is a target;
 * the follower's desired position is a scaled function of it; the planner emits
 * the difference. Events are demoted to "a hint that it is worth recomputing",
 * and the same recompute runs on a timer.
 *
 * Consequences, all free: a missed WebSocket message self-heals on the next
 * tick; running the planner twice produces one correction then nothing; a
 * restart reconciles by reading the venues rather than replaying a log; and
 * following a leader who is already in a position is not a special case.
 * See docs/03 §2.
 */
import type {
  Decimal,
  ExitIntent,
  MarketId,
  SizingMode,
  SkipDecision,
  SubscriptionId,
  Timestamp,
  TradeIntent,
  UserId,
} from "@slipstream/shared"
import type { Position, VenueId } from "@slipstream/venues"

/** What the follower's position in this market SHOULD be right now. */
export interface TargetPosition {
  readonly marketId: MarketId
  readonly side: "long" | "short"
  readonly size: Decimal
}

export interface PlanContext {
  readonly now: Timestamp
  readonly userId: UserId
  readonly subscriptionId: SubscriptionId
  readonly venue: VenueId
  readonly sizing: SizingMode
  readonly leaderPositions: readonly Position[]
  readonly followerPositions: readonly Position[]
  /** null when unavailable. `equity_ratio` MUST fail closed rather than guess. */
  readonly leaderEquity: Decimal | null
  readonly followerEquity: Decimal | null
  /**
   * No correction is emitted below this. Without it, funding payments and mark
   * drift generate a permanent trickle of dust orders that burn the per-address
   * rate limit and pay fees for nothing. See docs/03 §2.
   */
  readonly toleranceBand: Decimal
}

/** Trades and exits are returned separately so callers cannot accidentally
 *  route an exit through the risk gate. */
export interface Plan {
  readonly trades: readonly TradeIntent[]
  readonly exits: readonly ExitIntent[]
  readonly skips: readonly SkipDecision[]
}
