/**
 * W6 — Hyperliquid tick/lot rules.
 *
 * Pure arithmetic: nothing here touches the network, and every value path is a
 * `Decimal`. This is the file that decides whether an order is accepted, so the
 * two rules it encodes are stated explicitly rather than inlined:
 *
 *  1. **Sizes truncate toward zero** to the asset's `szDecimals`. Rounding a
 *     size *up* would build a position larger than the caller asked for.
 *  2. **Prices round away from aggression** — a buy limit floors, a sell limit
 *     ceils — so quantization can never turn a passive order into a crossing
 *     one. Getting this backwards is the one thing quantization must never do.
 *
 * Hyperliquid's price grid is two caps applied at once:
 *  - at most `MAX_PRICE_SIG_FIGS` (5) significant figures;
 *  - at most `MAX_PRICE_DECIMALS[kind] - szDecimals` decimal places;
 *  - **except** that an integer price is always legal regardless of how many
 *    significant figures it has.
 *
 * Both caps are powers of ten, so a multiple of the coarser one is necessarily a
 * multiple of the finer one. That lets the two caps collapse into a single step
 * and a single rounding — nothing double-rounds.
 *
 * All four numbers were checked against live `/info` order books rather than
 * against documentation (see the W6 report): ETH (`szDecimals` 4) rests at
 * `2446.8`, where the significant-figure cap binds before the decimal cap;
 * DOGE (0) rests at `0.085362`, where both bind exactly; spot `@201`
 * (HREKT/USDC, 0) rests at `0.00000011`, which needs eight decimals and so
 * fixes spot's `MAX_PRICE_DECIMALS` at 8, not 6; and spot `@173` (RUB/USDC)
 * rests at `117667.0` — six significant figures, legal only under the integer
 * exemption.
 */
import { money } from "@slipstream/shared"
import type { Decimal, MarketId, Rounding } from "@slipstream/shared"
import type { MarketConstraints, OrderSide, QuantizedOrder } from "../types.js"

/** Hyperliquid trades perps and spot pairs; the price grid differs between them. */
export type HyperliquidMarketKind = "perp" | "spot"

/** A price carries at most this many significant figures — unless it is an integer. */
export const MAX_PRICE_SIG_FIGS = 5

/**
 * `MAX_DECIMALS` in Hyperliquid's tick-size rule: a price carries at most
 * `MAX_DECIMALS - szDecimals` decimal places.
 *
 * Spot is 8, not 6. Verified live: `@201` (HREKT/USDC, base `szDecimals` 0) has
 * resting orders at `0.00000011`. Under 6 that price quantizes to `0.000001`, a
 * ~90% move, and prices below `0.000001` collapse to zero.
 */
export const MAX_PRICE_DECIMALS: Readonly<Record<HyperliquidMarketKind, number>> = {
  perp: 6,
  spot: 8,
}

/** Minimum order value in USDC. Not carried in `meta`; it is a venue-wide rule. */
export const MIN_ORDER_NOTIONAL = "10"

/** Scale used to compare an order's notional against the venue minimum. */
const NOTIONAL_SCALE = 8

/**
 * Everything the adapter needs to know about one tradable market, resolved once
 * from `meta`/`spotMeta` so that `constraints()` and `quantize()` can stay
 * synchronous and do no I/O.
 */
export interface AssetSpec {
  readonly marketId: MarketId
  /** Wire name accepted by `/info` and the WS channels: `BTC`, `@107`, `PURR/USDC`. */
  readonly coin: string
  /** Human-facing label. Never an identifier. */
  readonly symbol: string
  readonly kind: HyperliquidMarketKind
  /** The `a` field of an order: perp = index in `meta.universe`, spot = 10000 +
   *  index in `spotMeta.universe`. */
  readonly assetIndex: number
  readonly szDecimals: number
  readonly isDelisted: boolean
  readonly constraints: MarketConstraints
}

/** `10^exponent` as a `Decimal`, for negative exponents too (`scale` stays >= 0). */
export const pow10 = (exponent: number): Decimal =>
  exponent >= 0 ? money.fromBigInt(10n ** BigInt(exponent), 0) : money.fromBigInt(1n, -exponent)

/**
 * `floor(log10(|d|))` computed from the digit count, never from `Math.log10` —
 * a float log of a large mantissa lands on the wrong side of a power of ten.
 * Undefined for zero; callers check first.
 */
const floorLog10 = (d: Decimal): number => {
  const digits = (d.mantissa < 0n ? -d.mantissa : d.mantissa).toString().length
  return digits - 1 - d.scale
}

/** Decimal places a price may carry on this market. */
export const priceDecimalsFor = (kind: HyperliquidMarketKind, szDecimals: number): number =>
  Math.max(0, MAX_PRICE_DECIMALS[kind] - szDecimals)

export const buildConstraints = (
  kind: HyperliquidMarketKind,
  szDecimals: number,
  maxLeverage: number,
): MarketConstraints => ({
  // The finest legal price increment. It is a floor, not the whole rule: above
  // ~10^5 the significant-figure cap coarsens the real grid, which a single
  // `Decimal` cannot express. `quantize()` applies both caps.
  priceTick: pow10(-priceDecimalsFor(kind, szDecimals)),
  sizeLot: pow10(-szDecimals),
  minNotional: money.parse(MIN_ORDER_NOTIONAL),
  maxLeverage: money.fromInt(maxLeverage),
  // Spot has no borrow: selling what you do not hold is not a short, it is a
  // rejected order. Reduce-only is likewise a perps concept here.
  supportsShort: kind === "perp",
  supportsReduceOnly: kind === "perp",
})

/**
 * Rounds `price` onto the venue's grid, away from aggression.
 *
 * Returns a value whose scale is exactly the number of decimals the grid step
 * needs — no redundant trailing zeros — because Hyperliquid validates the
 * decimal count of the string it is sent.
 */
export const quantizePrice = (spec: AssetSpec, side: OrderSide, price: Decimal): Decimal => {
  // A zero price has no significant figure to anchor the grid to; leave it
  // alone and let `belowMinimum` reject the order.
  if (money.isZero(price)) return price

  // Buy floors, sell ceils. Never the other way round: that is the mistake that
  // silently makes an order cross the spread.
  const rounding: Rounding = side === "buy" ? "floor" : "ceil"

  const decimalsExponent = -priceDecimalsFor(spec.kind, spec.szDecimals)
  const sigFigsExponent = floorLog10(price) - (MAX_PRICE_SIG_FIGS - 1)
  // Both caps must hold simultaneously, so take the coarser step; both are
  // powers of ten, so satisfying the coarser one satisfies the finer one too.
  // Then clamp at 10^0: an integer price is exempt from the significant-figure
  // cap, so the grid never gets coarser than 1.
  const stepExponent = Math.min(0, Math.max(decimalsExponent, sigFigsExponent))

  const quantized = money.quantizeToStep(price, pow10(stepExponent), rounding)
  // Exact: `quantized` is already a multiple of the step, so this only drops
  // trailing zeros that `quantizeToStep` carried over from the input's scale.
  return money.rescale(quantized, Math.max(0, -stepExponent), rounding)
}

/** Truncates `size` onto the asset's lot. Toward zero, always. */
export const quantizeSize = (spec: AssetSpec, size: Decimal): Decimal =>
  money.rescale(
    money.quantizeToStep(size, spec.constraints.sizeLot, "trunc"),
    spec.szDecimals,
    "trunc",
  )

/**
 * True when the quantized order is too small to submit.
 *
 * With no price (a market order) the notional is unknowable here, so only the
 * zero-size case is caught; the caller checks notional against the book.
 */
const isBelowMinimum = (spec: AssetSpec, price: Decimal | null, size: Decimal): boolean => {
  if (money.isZero(size)) return true
  if (price === null) return false
  // Truncating understates the notional, which can only make this stricter.
  const notional = money.mul(money.abs(price), money.abs(size), NOTIONAL_SCALE, "trunc")
  return money.lt(notional, spec.constraints.minNotional)
}

export const quantizeOrder = (
  spec: AssetSpec,
  side: OrderSide,
  price: Decimal | null,
  size: Decimal,
): QuantizedOrder => {
  const quantizedSize = quantizeSize(spec, size)
  const quantizedPrice = price === null ? null : quantizePrice(spec, side, price)
  return {
    price: quantizedPrice,
    size: quantizedSize,
    belowMinimum: isBelowMinimum(spec, quantizedPrice, quantizedSize),
  }
}
