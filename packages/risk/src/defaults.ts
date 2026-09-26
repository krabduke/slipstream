/** W14 — conservative defaults. A user who wants to be reckless types the
 *  number themselves; that is both a safety and an informed-consent property.
 *
 *  Source of truth: docs/03 §4. Do not "improve" these numbers — every one of
 *  them is a decision, not a placeholder.
 */
import { money } from "@slipstream/shared"
import type { VenueId } from "@slipstream/shared"
import type { RiskLimits } from "./types.js"

/** Fractions (percentages of equity, of a book) carry four decimal places:
 *  enough to express a basis point of equity without ever being a float. */
const FRACTION_SCALE = 4
/** Dollars and leverage multiples. */
const MONEY_SCALE = 2

/**
 * Slippage tolerance is venue-shaped, not user-shaped by default: 50 bps is
 * generous on a Hyperliquid perp and absurdly tight on a Polymarket outcome
 * whose whole book lives inside a few cents. Copying the perp number onto a
 * prediction market would skip every signal; copying the prediction-market
 * number onto a perp would chase a whale's own impact, which is the exact
 * failure docs/03 §1.1 describes.
 */
export const DEFAULT_MAX_SLIPPAGE_BPS: Readonly<Record<VenueId, number>> = Object.freeze({
  hyperliquid: 50,
  polymarket: 300,
})

/**
 * The default limits for a subscription on `venue`.
 *
 * Takes the venue rather than defaulting to one, because the only two ways to
 * get slippage wrong are to guess the venue or to hardcode a number — and a
 * silently wrong slippage limit is invisible until it has either skipped
 * everything or copied a trade at the wrong side of a whale's impact.
 *
 * A function rather than a constant because every value is a `Decimal` built
 * from a string, and because callers get a fresh frozen object rather than a
 * shared one they might be tempted to mutate.
 */
/**
 * How old a leader's fill may be before copying it counts as chasing.
 * Hyperliquid fills arrive over a WebSocket within a second; Polymarket's are
 * read by polling (30s) behind the venue's own indexing delay, so 5s there
 * would refuse every copy. The slippage gate (300 bps) still refuses to chase
 * a price that has already run.
 */
export const DEFAULT_MAX_SIGNAL_AGE_MS: Readonly<Record<VenueId, number>> = Object.freeze({
  hyperliquid: 5_000,
  polymarket: 120_000,
})

export const DEFAULT_LIMITS = (venue: VenueId): RiskLimits =>
  Object.freeze({
    /** $1000 of notional in any single position. */
    maxNotionalPerPosition: money.parse("1000", MONEY_SCALE),
    /** ...and no more than 20% of the account in one of them. */
    maxPositionPctEquity: money.parse("0.20", FRACTION_SCALE),
    /** Total exposure across all positions: 50% of equity. */
    maxTotalExposure: money.parse("0.50", FRACTION_SCALE),
    /** 3x. At 3x a 33% move against you is a liquidation (docs/05 §3). */
    maxLeverage: money.parse("3", MONEY_SCALE),
    maxSlippageBps: DEFAULT_MAX_SLIPPAGE_BPS[venue],
    /** Five seconds. Older than this and the price that made the signal
     *  attractive is not the price on the screen any more. */
    maxSignalAgeMs: DEFAULT_MAX_SIGNAL_AGE_MS[venue],
    /** Consume at most 20% of the depth inside the slippage band. */
    maxBookPct: money.parse("0.20", FRACTION_SCALE),
    /** Stop opening for the day after losing 10% of equity. */
    dailyLossLimit: money.parse("0.10", FRACTION_SCALE),
    /** Keep 20% of the venue action budget in reserve, so that an exit or a
     *  kill-switch flatten always has budget left to execute with. */
    rateBudgetReserve: money.parse("0.20", FRACTION_SCALE),
  })
