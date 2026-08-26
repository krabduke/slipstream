/**
 * Core domain vocabulary: what the engine decides to do, and why.
 *
 * Lives in `shared` rather than in `copy` or `risk` because both need it and
 * neither may depend on the other.
 *
 * THE LOAD-BEARING DESIGN HERE: `TradeIntent` and `ExitIntent` are distinct
 * types, and every risk gate accepts only `TradeIntent`. Exits are therefore
 * structurally ungateable — blocking one is a compile error, not a code-review
 * miss. A gate that can block an exit traps a follower in a leveraged position
 * their leader has already abandoned. See docs/03 §5.
 */
import type { Decimal } from "../money/types.js"
import type {
  Address,
  IdempotencyKey,
  IntentId,
  MarketId,
  SubscriptionId,
  Timestamp,
  UserId,
} from "../brand.js"

export type VenueId = "hyperliquid" | "polymarket"
export type OrderSide = "buy" | "sell"

/** Why the planner produced this intent — copied straight into the ledger. */
export interface LeaderRef {
  readonly leaderAddress: Address
  readonly leaderFillPrice: Decimal
  readonly leaderFillTs: Timestamp
}

export interface TradeIntent {
  readonly kind: "trade"
  readonly id: IntentId
  readonly userId: UserId
  /** null for manual trades. Manual orders traverse the same executor and the
   *  same caps — your limits protect you from your own 2am clicking. */
  readonly subscriptionId: SubscriptionId | null
  readonly venue: VenueId
  readonly marketId: MarketId
  readonly side: OrderSide
  readonly size: Decimal
  readonly limitPrice: Decimal | null
  readonly idempotencyKey: IdempotencyKey
  readonly leaderRef: LeaderRef | null
  readonly createdAt: Timestamp
}

export type ExitReason =
  | "leader_closed"
  | "leader_reduced"
  | "orphan"
  | "kill_switch_flatten"
  | "user_requested"
  | "market_resolved"

/**
 * An exit. Carries no gate-relevant fields by construction and is never passed
 * to `Gate.evaluate`. Executed aggressively (IOC/market) by default: a
 * partially filled exit is worse than a slightly worse price.
 */
export interface ExitIntent {
  readonly kind: "exit"
  readonly id: IntentId
  readonly userId: UserId
  readonly subscriptionId: SubscriptionId | null
  readonly venue: VenueId
  readonly marketId: MarketId
  /** null means flatten the whole position. */
  readonly size: Decimal | null
  readonly reason: ExitReason
  readonly idempotencyKey: IdempotencyKey
  readonly createdAt: Timestamp
}

export type Intent = TradeIntent | ExitIntent

/**
 * The closed set of reasons the engine declines to act. Closed on purpose:
 * a free-text reason is a reason nobody can filter, chart, or explain back to
 * a user. Adding a value is a deliberate act with a UI copy consequence.
 */
export type ReasonCode =
  | "kill_switch_global"
  | "kill_switch_user"
  | "kill_switch_subscription"
  | "market_filtered"
  | "market_not_open"
  | "signal_stale"
  | "slippage_exceeded"
  | "book_too_thin"
  | "position_cap"
  | "position_pct_equity_cap"
  | "exposure_cap"
  | "leverage_cap"
  | "daily_loss_limit"
  | "rate_budget_low"
  | "leader_equity_unavailable"
  | "follower_equity_unavailable"
  | "below_min_notional"
  | "below_tolerance_band"
  | "insufficient_margin"
  | "venue_rejected"
  | "paper_mode"

/**
 * A decision NOT to act, recorded with the numbers that caused it.
 *
 * This is a product feature, not a debug log. It is what proves the bot is
 * working when it appears to be doing nothing, and it is shown in the UI with
 * equal prominence to fills. See docs/03 §7 and docs/05 §3.
 */
export interface SkipDecision {
  readonly kind: "skip"
  readonly userId: UserId
  readonly subscriptionId: SubscriptionId | null
  readonly venue: VenueId
  readonly marketId: MarketId
  readonly reason: ReasonCode
  /** Machine-readable numbers behind the decision, e.g.
   *  `{ observedBps: "87", limitBps: "50", bestAsk: "64769.0" }`.
   *  Values are pre-formatted strings so the ledger never stores a float. */
  readonly detail: Readonly<Record<string, string>>
  readonly leaderRef: LeaderRef | null
  readonly createdAt: Timestamp
}

export type Decision = TradeIntent | ExitIntent | SkipDecision

/**
 * How a follower's position is scaled from a leader's.
 * Modes propose; caps dispose — every mode's output passes through the risk
 * gate afterwards. See docs/03 §3.
 */
export type SizingMode =
  /** Scale-free: take their risk profile, not their dollar size. Fails closed
   *  if leader equity is unavailable — guessing it to size a leveraged
   *  position is not acceptable. */
  | { readonly mode: "equity_ratio"; readonly multiplier: Decimal }
  /** Fixed dollar notional per position, regardless of what they do. */
  | { readonly mode: "fixed_notional"; readonly notional: Decimal }
  /** Fixed percentage of the follower's own equity. */
  | { readonly mode: "percent_equity"; readonly percent: Decimal }
  /** Their size times k. Dangerous — a whale's routine trade can exceed a
   *  whole account. Gated behind explicit confirmation and always clamped. */
  | { readonly mode: "fixed_multiplier"; readonly k: Decimal }
