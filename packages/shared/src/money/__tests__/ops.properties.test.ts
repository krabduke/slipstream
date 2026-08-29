/**
 * W1 — money property tests.
 *
 * Example tests only prove the cases someone thought of, and money bugs are
 * exactly the ones nobody thought of: the value that is one unit past where the
 * rounding flips, the scale pair nobody paired. Every arbitrary here is bigint
 * and integer scale — fast-check never generates a float into a money value.
 */
import fc from "fast-check"
import type { Arbitrary } from "fast-check"
import { describe, expect, it } from "vitest"
import { money } from "../ops.js"
import type { Decimal, Rounding } from "../types.js"

const MAX_TEST_SCALE = 12

const arbScale = fc.integer({ min: 0, max: MAX_TEST_SCALE })

/** Wide enough that results outrun a double's 53 bits of mantissa. */
const arbMantissa = fc.bigInt({ min: -(10n ** 24n), max: 10n ** 24n })

const arbDecimal: Arbitrary<Decimal> = fc
  .tuple(arbMantissa, arbScale)
  .map(([mantissa, scale]) => money.fromBigInt(mantissa, scale))

const arbPositive: Arbitrary<Decimal> = fc
  .tuple(fc.bigInt({ min: 1n, max: 10n ** 24n }), arbScale)
  .map(([mantissa, scale]) => money.fromBigInt(mantissa, scale))

const arbNonZero: Arbitrary<Decimal> = arbDecimal.filter((x) => !money.isZero(x))

const arbRounding: Arbitrary<Rounding> = fc.constantFrom(
  ...(["floor", "ceil", "trunc", "half-even"] as const),
)

/** Compares two decimals as exact integers on a common scale — the test's own
 *  arithmetic, independent of cmp(), so a bug in cmp cannot hide behind it. */
const alignedPair = (a: Decimal, b: Decimal): [bigint, bigint] => {
  const common = Math.max(a.scale, b.scale)
  return [
    a.mantissa * 10n ** BigInt(common - a.scale),
    b.mantissa * 10n ** BigInt(common - b.scale),
  ]
}

const isMultipleOf = (value: Decimal, step: Decimal): boolean => {
  const [v, s] = alignedPair(value, step)
  return v % s === 0n
}

const absOf = (m: bigint): bigint => (m < 0n ? -m : m)

describe("parse / format round-trip", () => {
  it("format then parse returns the identical mantissa and scale", () => {
    fc.assert(
      fc.property(arbDecimal, (value) => {
        const reparsed = money.parse(money.format(value))
        expect(reparsed.mantissa).toBe(value.mantissa)
        expect(reparsed.scale).toBe(value.scale)
      }),
      { numRuns: 500 },
    )
  })

  it("format never uses exponent notation and never signs a zero", () => {
    fc.assert(
      fc.property(arbDecimal, (value) => {
        const text = money.format(value)
        expect(text).not.toMatch(/[eE]/)
        expect(text.startsWith("-0") && !/[1-9]/.test(text)).toBe(false)
      }),
      { numRuns: 500 },
    )
  })

  it("parse then format returns the identical string for canonical input", () => {
    fc.assert(
      fc.property(arbDecimal, (value) => {
        const text = money.format(value)
        expect(money.format(money.parse(text))).toBe(text)
      }),
      { numRuns: 300 },
    )
  })
})

describe("add / sub", () => {
  it("sub inverts add", () => {
    fc.assert(
      fc.property(arbDecimal, arbDecimal, (a, b) => {
        expect(money.eq(money.sub(money.add(a, b), b), a)).toBe(true)
        expect(money.eq(money.add(money.sub(a, b), b), a)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it("add is commutative", () => {
    fc.assert(
      fc.property(arbDecimal, arbDecimal, (a, b) => {
        const left = money.add(a, b)
        const right = money.add(b, a)
        expect(left.mantissa).toBe(right.mantissa)
        expect(left.scale).toBe(right.scale)
      }),
      { numRuns: 500 },
    )
  })

  it("add is associative", () => {
    fc.assert(
      fc.property(arbDecimal, arbDecimal, arbDecimal, (a, b, c) => {
        const left = money.add(money.add(a, b), c)
        const right = money.add(a, money.add(b, c))
        expect(left.mantissa).toBe(right.mantissa)
        expect(left.scale).toBe(right.scale)
      }),
      { numRuns: 500 },
    )
  })

  it("adding zero at any scale changes no value", () => {
    fc.assert(
      fc.property(arbDecimal, arbScale, (a, scale) => {
        expect(money.eq(money.add(a, money.fromBigInt(0n, scale)), a)).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  it("neg is its own inverse and sub(a, a) is exactly zero", () => {
    fc.assert(
      fc.property(arbDecimal, (a) => {
        expect(money.neg(money.neg(a)).mantissa).toBe(a.mantissa)
        expect(money.sub(a, a).mantissa).toBe(0n)
      }),
      { numRuns: 300 },
    )
  })
})

describe("rescale", () => {
  it("narrowing under trunc then widening back never increases magnitude", () => {
    fc.assert(
      fc.property(arbDecimal, arbScale, (a, narrower) => {
        const target = Math.min(narrower, a.scale)
        const round = money.rescale(a, target, "trunc")
        const back = money.rescale(round, a.scale, "trunc")
        expect(absOf(back.mantissa) <= absOf(a.mantissa)).toBe(true)
        // Toward zero also means the sign can never flip.
        if (!money.isZero(back)) {
          expect(money.isNegative(back)).toBe(money.isNegative(a))
        }
      }),
      { numRuns: 500 },
    )
  })

  it("widening is exact under every rounding mode", () => {
    fc.assert(
      fc.property(arbDecimal, arbScale, arbRounding, (a, extra, rounding) => {
        const target = Math.min(a.scale + extra, MAX_TEST_SCALE * 2)
        const wider = money.rescale(a, target, rounding)
        expect(money.eq(wider, a)).toBe(true)
        expect(money.rescale(wider, a.scale, "trunc").mantissa).toBe(a.mantissa)
      }),
      { numRuns: 500 },
    )
  })

  it("floor never rounds up and ceil never rounds down", () => {
    fc.assert(
      fc.property(arbDecimal, arbScale, (a, narrower) => {
        const target = Math.min(narrower, a.scale)
        expect(money.lte(money.rescale(a, target, "floor"), a)).toBe(true)
        expect(money.gte(money.rescale(a, target, "ceil"), a)).toBe(true)
        // trunc sits between the two, always.
        const truncated = money.rescale(a, target, "trunc")
        expect(money.gte(truncated, money.rescale(a, target, "floor"))).toBe(true)
        expect(money.lte(truncated, money.rescale(a, target, "ceil"))).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it("every rounding mode lands within one unit of the target scale", () => {
    fc.assert(
      fc.property(arbDecimal, arbScale, arbRounding, (a, narrower, rounding) => {
        const target = Math.min(narrower, a.scale)
        const rounded = money.rescale(a, target, rounding)
        expect(rounded.scale).toBe(target)
        const unit = money.fromBigInt(1n, target)
        const drift = money.abs(money.sub(rounded, a))
        expect(money.lt(drift, unit)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })
})

describe("quantizeToStep", () => {
  it("trunc never overshoots a positive value and always lands on a multiple", () => {
    fc.assert(
      fc.property(arbPositive, arbPositive, (a, step) => {
        const quantized = money.quantizeToStep(a, step, "trunc")
        expect(money.lte(quantized, a)).toBe(true)
        expect(isMultipleOf(quantized, step)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it("lands on a multiple of step for every sign and mode", () => {
    fc.assert(
      fc.property(arbDecimal, arbPositive, arbRounding, (a, step, rounding) => {
        expect(isMultipleOf(money.quantizeToStep(a, step, rounding), step)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it("never moves a value by a whole step", () => {
    fc.assert(
      fc.property(arbDecimal, arbPositive, arbRounding, (a, step, rounding) => {
        const drift = money.abs(money.sub(money.quantizeToStep(a, step, rounding), a))
        expect(money.lt(drift, step)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it("is idempotent — quantizing a multiple leaves it alone", () => {
    fc.assert(
      fc.property(arbDecimal, arbPositive, arbRounding, (a, step, rounding) => {
        const once = money.quantizeToStep(a, step, rounding)
        const twice = money.quantizeToStep(once, step, rounding)
        expect(money.eq(twice, once)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it("trunc quantization moves toward zero, never away from it", () => {
    fc.assert(
      fc.property(arbDecimal, arbPositive, (a, step) => {
        const quantized = money.quantizeToStep(a, step, "trunc")
        expect(money.lte(money.abs(quantized), money.abs(a))).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it("a buy limit is never raised and a sell limit is never lowered", () => {
    fc.assert(
      fc.property(arbPositive, arbPositive, (price, tick) => {
        expect(money.lte(money.quantizeToStep(price, tick, "floor"), price)).toBe(true)
        expect(money.gte(money.quantizeToStep(price, tick, "ceil"), price)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })
})

describe("cmp is a total order", () => {
  it("is reflexive, antisymmetric and agrees with the sign of sub", () => {
    fc.assert(
      fc.property(arbDecimal, arbDecimal, (a, b) => {
        const order = money.cmp(a, b)
        expect(money.cmp(a, a)).toBe(0)
        expect(money.cmp(b, a)).toBe(-order)

        const difference = money.sub(a, b).mantissa
        const sign = difference === 0n ? 0 : difference < 0n ? -1 : 1
        expect(order).toBe(sign)

        const [left, right] = alignedPair(a, b)
        expect(order).toBe(left < right ? -1 : left > right ? 1 : 0)
      }),
      { numRuns: 500 },
    )
  })

  it("is transitive", () => {
    fc.assert(
      fc.property(arbDecimal, arbDecimal, arbDecimal, (a, b, c) => {
        if (money.lte(a, b) && money.lte(b, c)) expect(money.lte(a, c)).toBe(true)
        if (money.lt(a, b) && money.lt(b, c)) expect(money.lt(a, c)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it("the predicates are consistent with cmp", () => {
    fc.assert(
      fc.property(arbDecimal, arbDecimal, (a, b) => {
        const order = money.cmp(a, b)
        expect(money.eq(a, b)).toBe(order === 0)
        expect(money.lt(a, b)).toBe(order < 0)
        expect(money.lte(a, b)).toBe(order <= 0)
        expect(money.gt(a, b)).toBe(order > 0)
        expect(money.gte(a, b)).toBe(order >= 0)
        expect(money.eq(money.min(a, b), order <= 0 ? a : b)).toBe(true)
        expect(money.eq(money.max(a, b), order >= 0 ? a : b)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  it("equality is scale-blind while format is not", () => {
    fc.assert(
      fc.property(arbDecimal, fc.integer({ min: 1, max: 6 }), (a, extra) => {
        const wider = money.rescale(a, a.scale + extra, "trunc")
        expect(money.eq(wider, a)).toBe(true)
        expect(money.format(wider)).not.toBe(money.format(a))
      }),
      { numRuns: 300 },
    )
  })
})

describe("mul and div", () => {
  it("multiplying by one is the identity at a sufficient scale", () => {
    fc.assert(
      fc.property(arbDecimal, (a) => {
        expect(money.eq(money.mul(a, money.fromInt(1), a.scale, "trunc"), a)).toBe(true)
        expect(money.mul(a, money.fromInt(0), a.scale, "trunc").mantissa).toBe(0n)
      }),
      { numRuns: 300 },
    )
  })

  it("mul is commutative and sign-correct", () => {
    fc.assert(
      fc.property(arbDecimal, arbDecimal, arbScale, arbRounding, (a, b, scale, rounding) => {
        const left = money.mul(a, b, scale, rounding)
        const right = money.mul(b, a, scale, rounding)
        expect(left.mantissa).toBe(right.mantissa)
        const exact = a.mantissa * b.mantissa
        if (exact !== 0n && left.mantissa !== 0n) {
          expect(left.mantissa < 0n).toBe(exact < 0n)
        }
      }),
      { numRuns: 500 },
    )
  })

  it("div then mul returns to within a rounding unit of the original", () => {
    fc.assert(
      fc.property(arbDecimal, arbNonZero, (a, b) => {
        // A quotient truncated at scale s is off by under 10^-s, and
        // multiplying back magnifies that by |b|. Carrying |b|'s digit count
        // plus one keeps the magnified error under one unit at a.scale; the
        // final truncation can then add one more, and no more than one more.
        const digits = money.format(money.abs(b)).replace(/\D/g, "").length
        const quotient = money.div(a, b, a.scale + digits + 1, "trunc")
        const restored = money.mul(quotient, b, a.scale, "trunc")
        const drift = money.abs(money.sub(restored, a))
        expect(money.lte(drift, money.fromBigInt(2n, a.scale))).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  it("div by zero always throws, whatever the scale", () => {
    fc.assert(
      fc.property(arbDecimal, arbScale, arbScale, arbRounding, (a, zeroScale, scale, rounding) => {
        expect(() => money.div(a, money.fromBigInt(0n, zeroScale), scale, rounding)).toThrow(
          /division by zero/,
        )
      }),
      { numRuns: 200 },
    )
  })
})

describe("bps helpers", () => {
  it("bpsOf 10000 bps is the value itself", () => {
    fc.assert(
      fc.property(arbDecimal, (a) => {
        expect(money.eq(money.bpsOf(a, 10000, a.scale, "trunc"), a)).toBe(true)
        expect(money.bpsOf(a, 0, a.scale, "trunc").mantissa).toBe(0n)
      }),
      { numRuns: 300 },
    )
  })

  it("diffBps has the sign of actual - reference for a positive reference", () => {
    fc.assert(
      fc.property(arbPositive, arbDecimal, (reference, actual) => {
        const bps = money.diffBps(reference, actual)
        const order = money.cmp(actual, reference)
        expect(Number.isInteger(bps)).toBe(true)
        if (bps !== 0) expect(Math.sign(bps)).toBe(order)
        expect(money.diffBps(reference, reference)).toBe(0)
      }),
      { numRuns: 500 },
    )
  })

  it("diffBps agrees with bpsOf applied to the reference", () => {
    fc.assert(
      fc.property(arbPositive, fc.integer({ min: -9999, max: 9999 }), (reference, bps) => {
        // reference + bpsOf(reference, bps) is bps away from reference by
        // construction, so diffBps must report bps back (bar the one unit that
        // bpsOf's own rounding can drop).
        const moved = money.add(reference, money.bpsOf(reference, bps, reference.scale + 8, "trunc"))
        expect(Math.abs(money.diffBps(reference, moved) - bps)).toBeLessThanOrEqual(1)
      }),
      { numRuns: 300 },
    )
  })
})
