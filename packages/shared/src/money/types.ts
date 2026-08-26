/**
 * Fixed-point decimal money.
 *
 * Floats are banned in every path that touches an order. `0.1 + 0.2` in a size
 * calculation is a rejected order at best and a wrong position at worst.
 *
 * A `Decimal` is `mantissa * 10^-scale`. `scale` is always >= 0.
 * Implementation is W1's territory (packages/shared/src/money/ops.ts); this
 * file is the contract and is fixed.
 */

declare const decimalBrand: unique symbol

export interface Decimal {
  readonly mantissa: bigint
  readonly scale: number
  readonly [decimalBrand]?: never
}

/**
 * Rounding is never implicit and never "whatever is nearest".
 *
 * - `floor` / `ceil`  — toward -inf / +inf.
 * - `trunc`           — toward zero. This is what sizes use: rounding a size
 *                       up can create an order larger than intended.
 * - `half-even`       — banker's rounding, for display and PnL aggregation
 *                       only, never for order construction.
 *
 * Price rounding direction is chosen by the *caller* based on side, so that
 * quantization can never make an order more aggressive than intended:
 * a buy limit rounds `floor`, a sell limit rounds `ceil`. See docs/02 §5.
 */
export type Rounding = "floor" | "ceil" | "trunc" | "half-even"

/**
 * The complete money surface. `packages/shared/src/money/ops.ts` must export a
 * `const money: MoneyOps` so the compiler proves nothing is missing.
 */
export interface MoneyOps {
  /** Parse a venue string ("1234.5678", "-0.001", "1e-6"). Throws on garbage.
   *  Never route venue strings through parseFloat. */
  parse(s: string, scale?: number): Decimal
  fromBigInt(mantissa: bigint, scale: number): Decimal
  fromInt(n: number, scale?: number): Decimal

  /** Canonical string. No exponent notation, no trailing-zero stripping —
   *  the scale is part of the value and round-trips through parse(). */
  format(d: Decimal): string
  /** Human display only. May strip zeros and group digits. Never send to a venue. */
  display(d: Decimal, maxDecimals?: number): string

  add(a: Decimal, b: Decimal): Decimal
  sub(a: Decimal, b: Decimal): Decimal
  mul(a: Decimal, b: Decimal, scale: number, rounding: Rounding): Decimal
  div(a: Decimal, b: Decimal, scale: number, rounding: Rounding): Decimal
  neg(a: Decimal): Decimal
  abs(a: Decimal): Decimal

  /** -1 | 0 | 1 */
  cmp(a: Decimal, b: Decimal): -1 | 0 | 1
  eq(a: Decimal, b: Decimal): boolean
  lt(a: Decimal, b: Decimal): boolean
  lte(a: Decimal, b: Decimal): boolean
  gt(a: Decimal, b: Decimal): boolean
  gte(a: Decimal, b: Decimal): boolean
  isZero(a: Decimal): boolean
  isNegative(a: Decimal): boolean
  min(a: Decimal, b: Decimal): Decimal
  max(a: Decimal, b: Decimal): Decimal

  /** Change scale explicitly. Cross-scale arithmetic must rescale first —
   *  there is no implicit widening anywhere in this API. */
  rescale(a: Decimal, scale: number, rounding: Rounding): Decimal

  /** Round `a` down to the nearest multiple of `step`, toward zero.
   *  This is the primitive venue lot/tick quantization is built from. */
  quantizeToStep(a: Decimal, step: Decimal, rounding: Rounding): Decimal

  /** Basis-point helpers — used by the slippage gate, so they are part of the
   *  contract rather than reimplemented per caller. */
  bpsOf(a: Decimal, bps: number, scale: number, rounding: Rounding): Decimal
  /** Signed difference of `actual` from `reference`, in basis points. */
  diffBps(reference: Decimal, actual: Decimal): number
}

export const ZERO_SCALE = 0
