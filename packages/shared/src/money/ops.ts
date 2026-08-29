/**
 * W1 — fixed-point decimal implementation. Contract: ./types.ts
 *
 * A `Decimal` is `mantissa * 10^-scale` with `scale >= 0`. Every value path in
 * this file is bigint arithmetic: there is no `number` holding a money value,
 * and no venue string is ever routed through `parseFloat` / `Number()`.
 *
 * Rounding is never implicit. Operations that can lose precision (`mul`, `div`,
 * `rescale`, `quantizeToStep`, `bpsOf`) take the mode from the caller and round
 * exactly once, so nothing double-rounds. Operations that cannot lose precision
 * (`add`, `sub`, `cmp`) widen to a common scale exactly instead.
 *
 * There is no negative zero here: bigint has none (`-0n === 0n`), sign is read
 * from the mantissa alone, and `scale` is normalised so a `-0` scale cannot
 * survive into a value.
 */
import type { Decimal, MoneyOps, Rounding } from "./types.js"

/** Sanity bound on `scale`. Money never needs more than ~30 decimal places, and
 *  an unbounded scale turns a hostile venue string ("1e2000000000") into a
 *  10^n bigint that hangs the process. */
const MAX_SCALE = 1000

const pow10 = (n: number): bigint => 10n ** BigInt(n)

/** Validates a scale and returns it normalised (`-0` collapsed to `0`). */
const assertScale = (scale: number, what: string): number => {
  if (!Number.isInteger(scale)) {
    throw new RangeError(`${what}: scale must be an integer, got ${String(scale)}`)
  }
  // Scale never goes negative: "1e6" is scale 0 mantissa 1000000, not scale -6.
  if (scale < 0) throw new RangeError(`${what}: scale must be >= 0, got ${String(scale)}`)
  if (scale > MAX_SCALE) {
    throw new RangeError(`${what}: scale must be <= ${MAX_SCALE}, got ${String(scale)}`)
  }
  return scale === 0 ? 0 : scale
}

const make = (mantissa: bigint, scale: number): Decimal => Object.freeze({ mantissa, scale })

/** Exact widening. `to` must be >= `from`; no digits can be lost. */
const widen = (mantissa: bigint, from: number, to: number): bigint =>
  to === from ? mantissa : mantissa * pow10(to - from)

/**
 * Integer division under an explicit rounding mode. `den` must be non-zero —
 * every caller checks first so the thrown message names the operation.
 */
const divRound = (num: bigint, den: bigint, rounding: Rounding): bigint => {
  const q = num / den // bigint division truncates toward zero
  const r = num % den // remainder carries the sign of num
  if (r === 0n) return q
  const negative = num < 0n !== den < 0n
  switch (rounding) {
    case "trunc":
      // Toward zero. For negatives this is deliberately NOT floor.
      return q
    case "floor":
      return negative ? q - 1n : q
    case "ceil":
      return negative ? q : q + 1n
    case "half-even": {
      const twiceRest = 2n * (r < 0n ? -r : r)
      const absDen = den < 0n ? -den : den
      if (twiceRest > absDen) return negative ? q - 1n : q + 1n
      if (twiceRest < absDen) return q
      // Exact tie: take the even neighbour.
      return q % 2n === 0n ? q : negative ? q - 1n : q + 1n
    }
  }
  const unreachable: never = rounding
  throw new RangeError(`money: unknown rounding mode ${String(unreachable)}`)
}

/** Restate a mantissa from one scale to another, rounding at most once. */
const restate = (mantissa: bigint, from: number, to: number, rounding: Rounding): bigint =>
  to >= from ? widen(mantissa, from, to) : divRound(mantissa, pow10(from - to), rounding)

const cmpDecimal = (a: Decimal, b: Decimal, what: string): -1 | 0 | 1 => {
  const common = Math.max(assertScale(a.scale, what), assertScale(b.scale, what))
  const left = widen(a.mantissa, a.scale, common)
  const right = widen(b.mantissa, b.scale, common)
  return left < right ? -1 : left > right ? 1 : 0
}

/** Optional sign, digits with an optional fraction, optional integer exponent. */
const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

export const money: MoneyOps = {
  /**
   * Parses a venue string directly into bigint digits — no float ever touches
   * the value. With an explicit `scale`, widening pads zeros and narrowing is
   * allowed only when it is exact; a narrowing that would drop a non-zero digit
   * throws rather than silently picking a rounding mode `parse` was not given.
   */
  parse(s: string, scale?: number): Decimal {
    if (typeof s !== "string") {
      throw new TypeError(`money.parse: expected a string, got ${typeof s}`)
    }
    if (!DECIMAL_RE.test(s)) {
      throw new SyntaxError(`money.parse: not a decimal string: ${JSON.stringify(s)}`)
    }

    let body = s
    let exponent = 0
    const eAt = body.search(/[eE]/)
    if (eAt >= 0) {
      // Integer exponent only; it shifts the scale, it never scales a float.
      exponent = Number.parseInt(body.slice(eAt + 1), 10)
      body = body.slice(0, eAt)
    }
    if (!Number.isFinite(exponent) || Math.abs(exponent) > MAX_SCALE) {
      throw new RangeError(`money.parse: exponent out of range in ${JSON.stringify(s)}`)
    }

    let negative = false
    const first = body[0]
    if (first === "+" || first === "-") {
      negative = first === "-"
      body = body.slice(1)
    }
    const dot = body.indexOf(".")
    const intDigits = dot < 0 ? body : body.slice(0, dot)
    const fracDigits = dot < 0 ? "" : body.slice(dot + 1)
    const digits = intDigits + fracDigits
    if (digits.length === 0) {
      throw new SyntaxError(`money.parse: no digits in ${JSON.stringify(s)}`)
    }

    let mantissa = BigInt(digits)
    if (negative) mantissa = -mantissa
    let natural = fracDigits.length - exponent
    if (natural < 0) {
      // A negative scale is not representable: fold the shift into the mantissa.
      mantissa *= pow10(-natural)
      natural = 0
    }
    natural = assertScale(natural, "money.parse")

    if (scale === undefined) return make(mantissa, natural)
    const target = assertScale(scale, "money.parse")
    if (target >= natural) return make(widen(mantissa, natural, target), target)
    const divisor = pow10(natural - target)
    if (mantissa % divisor !== 0n) {
      throw new RangeError(
        `money.parse: ${s} does not fit scale ${String(target)} exactly; ` +
          `parse it first, then rescale() with an explicit rounding mode`,
      )
    }
    return make(mantissa / divisor, target)
  },

  fromBigInt(mantissa: bigint, scale: number): Decimal {
    return make(mantissa, assertScale(scale, "money.fromBigInt"))
  },

  /** `n` is the VALUE, not the mantissa: `fromInt(5, 2)` is 5.00, not 0.05.
   *  Use `fromBigInt` when what you hold is already a mantissa. */
  fromInt(n: number, scale?: number): Decimal {
    if (!Number.isSafeInteger(n)) {
      throw new RangeError(`money.fromInt: n must be a safe integer, got ${String(n)}`)
    }
    const target = assertScale(scale ?? 0, "money.fromInt")
    return make(BigInt(n) * pow10(target), target)
  },

  /** Canonical, exponent-free, trailing zeros intact — `parse(format(d))` is `d`. */
  format(d: Decimal): string {
    const scale = assertScale(d.scale, "money.format")
    // Sign comes from the mantissa, and 0n is never negative, so "-0" is unreachable.
    const negative = d.mantissa < 0n
    const sign = negative ? "-" : ""
    const digits = (negative ? -d.mantissa : d.mantissa).toString()
    if (scale === 0) return sign + digits
    const padded = digits.padStart(scale + 1, "0")
    const cut = padded.length - scale
    return `${sign}${padded.slice(0, cut)}.${padded.slice(cut)}`
  },

  /** Human display only — never sent to a venue. Groups digits and strips
   *  trailing zeros, and rounds half-even when `maxDecimals` narrows. */
  display(d: Decimal, maxDecimals?: number): string {
    const scale = assertScale(d.scale, "money.display")
    const target =
      maxDecimals === undefined
        ? scale
        : Math.min(assertScale(maxDecimals, "money.display"), scale)
    const mantissa = restate(d.mantissa, scale, target, "half-even")
    const negative = mantissa < 0n
    const digits = (negative ? -mantissa : mantissa).toString().padStart(target + 1, "0")
    const cut = digits.length - target
    const grouped = digits.slice(0, cut).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    const frac = target === 0 ? "" : digits.slice(cut).replace(/0+$/, "")
    return `${negative ? "-" : ""}${grouped}${frac === "" ? "" : `.${frac}`}`
  },

  add(a: Decimal, b: Decimal): Decimal {
    const common = Math.max(assertScale(a.scale, "money.add"), assertScale(b.scale, "money.add"))
    return make(widen(a.mantissa, a.scale, common) + widen(b.mantissa, b.scale, common), common)
  },

  sub(a: Decimal, b: Decimal): Decimal {
    const common = Math.max(assertScale(a.scale, "money.sub"), assertScale(b.scale, "money.sub"))
    return make(widen(a.mantissa, a.scale, common) - widen(b.mantissa, b.scale, common), common)
  },

  mul(a: Decimal, b: Decimal, scale: number, rounding: Rounding): Decimal {
    const exactScale =
      assertScale(a.scale, "money.mul") + assertScale(b.scale, "money.mul")
    const target = assertScale(scale, "money.mul")
    // The product is exact at a.scale + b.scale; one rounded restate to target.
    return make(restate(a.mantissa * b.mantissa, exactScale, target, rounding), target)
  },

  div(a: Decimal, b: Decimal, scale: number, rounding: Rounding): Decimal {
    const aScale = assertScale(a.scale, "money.div")
    const bScale = assertScale(b.scale, "money.div")
    const target = assertScale(scale, "money.div")
    // No NaN, no Infinity, no zero fallback — a silent answer here opens a wrong position.
    if (b.mantissa === 0n) throw new RangeError("money.div: division by zero")
    const shift = bScale - aScale + target
    const num = shift >= 0 ? a.mantissa * pow10(shift) : a.mantissa
    const den = shift >= 0 ? b.mantissa : b.mantissa * pow10(-shift)
    return make(divRound(num, den, rounding), target)
  },

  neg(a: Decimal): Decimal {
    return make(-a.mantissa, assertScale(a.scale, "money.neg"))
  },

  abs(a: Decimal): Decimal {
    const scale = assertScale(a.scale, "money.abs")
    return make(a.mantissa < 0n ? -a.mantissa : a.mantissa, scale)
  },

  cmp(a: Decimal, b: Decimal): -1 | 0 | 1 {
    return cmpDecimal(a, b, "money.cmp")
  },

  eq(a: Decimal, b: Decimal): boolean {
    return cmpDecimal(a, b, "money.eq") === 0
  },

  lt(a: Decimal, b: Decimal): boolean {
    return cmpDecimal(a, b, "money.lt") < 0
  },

  lte(a: Decimal, b: Decimal): boolean {
    return cmpDecimal(a, b, "money.lte") <= 0
  },

  gt(a: Decimal, b: Decimal): boolean {
    return cmpDecimal(a, b, "money.gt") > 0
  },

  gte(a: Decimal, b: Decimal): boolean {
    return cmpDecimal(a, b, "money.gte") >= 0
  },

  isZero(a: Decimal): boolean {
    return a.mantissa === 0n
  },

  isNegative(a: Decimal): boolean {
    return a.mantissa < 0n
  },

  min(a: Decimal, b: Decimal): Decimal {
    const pick = cmpDecimal(a, b, "money.min") <= 0 ? a : b
    return make(pick.mantissa, pick.scale)
  },

  max(a: Decimal, b: Decimal): Decimal {
    const pick = cmpDecimal(a, b, "money.max") >= 0 ? a : b
    return make(pick.mantissa, pick.scale)
  },

  rescale(a: Decimal, scale: number, rounding: Rounding): Decimal {
    const from = assertScale(a.scale, "money.rescale")
    const target = assertScale(scale, "money.rescale")
    return make(restate(a.mantissa, from, target, rounding), target)
  },

  /**
   * Rounds `a` to a multiple of `step` under the caller's rounding mode.
   * Exact by construction: one rounded division for the multiple count, then an
   * exact multiplication back — never a division followed by a multiplication
   * that loses a unit in the last place. The result carries
   * `max(a.scale, step.scale)`, which is a widening of the exact value.
   */
  quantizeToStep(a: Decimal, step: Decimal, rounding: Rounding): Decimal {
    const aScale = assertScale(a.scale, "money.quantizeToStep")
    const stepScale = assertScale(step.scale, "money.quantizeToStep")
    if (step.mantissa <= 0n) {
      throw new RangeError(
        `money.quantizeToStep: step must be > 0, got mantissa ${step.mantissa.toString()}`,
      )
    }
    // a / step as an exact rational: (a.m * 10^stepScale) / (step.m * 10^aScale).
    const count = divRound(
      a.mantissa * pow10(stepScale),
      step.mantissa * pow10(aScale),
      rounding,
    )
    const target = Math.max(aScale, stepScale)
    return make(widen(count * step.mantissa, stepScale, target), target)
  },

  bpsOf(a: Decimal, bps: number, scale: number, rounding: Rounding): Decimal {
    const aScale = assertScale(a.scale, "money.bpsOf")
    const target = assertScale(scale, "money.bpsOf")
    if (!Number.isSafeInteger(bps)) {
      // A fractional bps would mean building a Decimal out of a float.
      throw new RangeError(`money.bpsOf: bps must be a safe integer, got ${String(bps)}`)
    }
    const shift = target - aScale
    const num = (shift >= 0 ? a.mantissa * pow10(shift) : a.mantissa) * BigInt(bps)
    const den = shift >= 0 ? 10000n : 10000n * pow10(-shift)
    return make(divRound(num, den, rounding), target)
  },

  /** `(actual - reference) / reference * 10000`, signed, toward zero. Computed
   *  entirely in bigint; only the final bps count becomes a `number`. */
  diffBps(reference: Decimal, actual: Decimal): number {
    const refScale = assertScale(reference.scale, "money.diffBps")
    const actScale = assertScale(actual.scale, "money.diffBps")
    if (reference.mantissa === 0n) {
      throw new RangeError("money.diffBps: reference is zero")
    }
    const common = Math.max(refScale, actScale)
    const ref = widen(reference.mantissa, refScale, common)
    const act = widen(actual.mantissa, actScale, common)
    // The 10^-common cancels in the ratio, so mantissas alone are exact here.
    return Number(divRound((act - ref) * 10000n, ref, "trunc"))
  },
}
