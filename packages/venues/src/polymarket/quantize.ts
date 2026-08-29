/**
 * W7 — Polymarket tick/lot rules. Contract: ../types.ts — do not modify it.
 *
 * Pure arithmetic, no I/O, no venue calls. `read.ts` owns the network and hands
 * this module the per-market rules it observed; this module owns the rounding.
 *
 * The single rule everything here exists to enforce (docs/02 §5): quantization
 * may never make an order *more* aggressive than the caller asked for.
 *
 *  - sizes round **toward zero** (`trunc`) — rounding a size up buys more than
 *    was intended, and on a venue with no shorting there is no cheap undo.
 *  - prices round **away from aggression**: a buy limit rounds `floor` (down,
 *    away from the ask), a sell limit rounds `ceil` (up, away from the bid).
 *
 * Both directions are chosen here rather than by the caller, because the whole
 * point of the `quantize` seam is that no caller has to know them.
 */
import { money } from "@slipstream/shared"
import type { Decimal } from "@slipstream/shared/money/types.js"
import type { MarketConstraints, OrderSide, QuantizedOrder } from "../types.js"

/**
 * The venue's finest price increment, and the fallback when the per-market tick
 * has not been observed yet.
 *
 * The tick is genuinely per-market: of 500 live open markets sampled from Gamma
 * on 2026-08-29, 381 reported `orderPriceMinTickSize: 0.001` and 119 reported
 * `0.01`. `read.ts` caches the real tick from the CLOB book / Gamma metadata and
 * passes it in; this constant only applies to a market nothing has read yet.
 */
export const PRICE_TICK_DEFAULT: Decimal = money.parse("0.001")

/** Shares carry 6dp, matching USDC's 6 decimals (docs/02 §4). */
export const SIZE_LOT: Decimal = money.parse("0.000001")

/**
 * Minimum order size **in shares**, not in dollars. Live-verified: the CLOB
 * book reports `min_order_size: "5"` and Gamma reports `orderMinSize: 5` on
 * every one of the 500 open markets sampled.
 *
 * `MarketConstraints` has no field for a minimum *size*, only `minNotional`, so
 * this floor can only be reported through `QuantizedOrder.belowMinimum`.
 */
export const MIN_ORDER_SHARES: Decimal = money.parse("5")

/** Polymarket's published minimum order *value* in USDC. Unlike the share floor
 *  above this one is not verifiable without placing an order, so it is applied
 *  only in the fail-closed direction: it can cause a skip, never a submission. */
export const MIN_ORDER_NOTIONAL: Decimal = money.parse("1")

/** No leverage, ever. Read via `constraints()`; never hardcoded by a caller. */
export const MAX_LEVERAGE: Decimal = money.parse("1")

const ONE: Decimal = money.parse("1")
const ZERO: Decimal = money.parse("0")

/** Scale used for the notional comparison. USDC is 6dp; so is a share. */
const NOTIONAL_SCALE = 6

/** What `read.ts` has learned about one market, or the venue defaults. */
export interface PolymarketMarketRules {
  /** Price increment accepted by the CLOB for this token. */
  readonly priceTick: Decimal
  /** Minimum order size in shares. */
  readonly minOrderShares: Decimal
}

export const DEFAULT_MARKET_RULES: PolymarketMarketRules = Object.freeze({
  priceTick: PRICE_TICK_DEFAULT,
  minOrderShares: MIN_ORDER_SHARES,
})

/**
 * Capabilities, not conditionals (docs/02 §1).
 *
 * `supportsShort: false` is literally true here rather than a simplification: a
 * `MarketId` is a CLOB token id, so it names an *outcome*. Selling YES is
 * buying NO, which is a different `MarketId` — there is no short leg to open.
 *
 * `supportsReduceOnly: false` for the same reason: the CLOB has no reduce-only
 * flag, and "reduce" on an outcome token is just a sell of shares held.
 */
export const polymarketConstraints = (
  rules: PolymarketMarketRules = DEFAULT_MARKET_RULES,
): MarketConstraints => ({
  priceTick: rules.priceTick,
  sizeLot: SIZE_LOT,
  minNotional: MIN_ORDER_NOTIONAL,
  maxLeverage: MAX_LEVERAGE,
  supportsShort: false,
  supportsReduceOnly: false,
})

/** Lowest price the CLOB will accept: one tick. Live books quote 0.001 bids. */
export const minPrice = (tick: Decimal): Decimal => tick

/** Highest price the CLOB will accept: one tick below certainty. Live books
 *  quote 0.999 asks on a 0.001-tick market. */
export const maxPrice = (tick: Decimal): Decimal => money.sub(ONE, tick)

/**
 * Rounds one order onto the venue's grid.
 *
 * `price` is `null` for a market order, which has no limit price to round; the
 * size is still quantized and the minimums still apply.
 *
 * `belowMinimum` means **skip, do not submit**. It is set when:
 *  - the quantized size is zero or under the venue's share floor;
 *  - the quantized limit price leaves the tradeable band `[tick, 1 - tick]`.
 *    Clamping back into the band is not an option: pulling a buy *up* to the
 *    first tick, or a sell *down* to the last, is exactly the "more aggressive
 *    than asked" move this module exists to prevent. `QuantizedOrder` has no
 *    other way to say "unplaceable", so it says it here;
 *  - the resulting notional is under `MIN_ORDER_NOTIONAL` (limit orders only —
 *    a market order has no price to compute a notional from).
 *
 * Throws only on inputs that are caller bugs rather than venue limits: a
 * negative size or a negative price can never be a legitimate order, and
 * silently coercing them would hide the bug that produced them.
 */
export const quantizePolymarketOrder = (
  side: OrderSide,
  price: Decimal | null,
  size: Decimal,
  rules: PolymarketMarketRules = DEFAULT_MARKET_RULES,
): QuantizedOrder => {
  if (money.isNegative(size)) {
    throw new RangeError(
      `polymarket.quantize: size must be >= 0, got ${money.format(size)}. ` +
        "Direction lives in `side`, never in the sign of a size.",
    )
  }
  if (price !== null && money.isNegative(price)) {
    throw new RangeError(`polymarket.quantize: price must be >= 0, got ${money.format(price)}`)
  }
  if (money.lte(rules.priceTick, ZERO)) {
    throw new RangeError(`polymarket.quantize: priceTick must be > 0, got ${money.format(rules.priceTick)}`)
  }

  // Toward zero. Never `floor`: for a size those differ only on negatives, and
  // a negative already threw above — but `trunc` is what the rule says, and the
  // rule is what a later reader checks against.
  const quantizedSize = exact(money.quantizeToStep(size, SIZE_LOT, "trunc"), SIZE_LOT.scale)

  const quantizedPrice =
    price === null
      ? null
      : exact(
          money.quantizeToStep(price, rules.priceTick, side === "buy" ? "floor" : "ceil"),
          rules.priceTick.scale,
        )

  const outOfBand =
    quantizedPrice !== null &&
    (money.lt(quantizedPrice, minPrice(rules.priceTick)) ||
      money.gt(quantizedPrice, maxPrice(rules.priceTick)))

  // Round the notional down, so a value sitting exactly on the boundary skips
  // rather than submits. Every ambiguity here resolves toward not trading.
  const belowNotional =
    quantizedPrice !== null &&
    money.lt(money.mul(quantizedSize, quantizedPrice, NOTIONAL_SCALE, "floor"), MIN_ORDER_NOTIONAL)

  return {
    price: quantizedPrice,
    size: quantizedSize,
    belowMinimum:
      money.lte(quantizedSize, ZERO) ||
      money.lt(quantizedSize, rules.minOrderShares) ||
      outOfBand ||
      belowNotional,
  }
}

/**
 * Drops the trailing zeros `quantizeToStep` leaves behind when the input was
 * finer than the step, so the value carries the step's own scale.
 *
 * The narrowing is exact by construction — the value is already a multiple of a
 * step at `scale`, so every digit being dropped is a zero — which is why the
 * rounding mode passed here can never actually round anything.
 */
const exact = (d: Decimal, scale: number): Decimal =>
  d.scale <= scale ? d : money.rescale(d, scale, "trunc")
