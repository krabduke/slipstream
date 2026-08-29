/**
 * W1 — money unit tests.
 *
 * These target the specific ways fixed-point money math goes plausibly wrong:
 * float round-trips, trailing zeros, trunc-vs-floor on negatives, negative zero,
 * division by zero, negative scale, and quantization that loses a unit in the
 * last place. There is no `number` literal standing for a money value anywhere
 * in this file — every expectation is a bigint mantissa or a canonical string.
 */
import { describe, expect, it } from "vitest"
import { money } from "../ops.js"
import type { Decimal } from "../types.js"

const d = (mantissa: bigint, scale: number): Decimal => money.fromBigInt(mantissa, scale)

describe("parse", () => {
  it("reads venue strings digit by digit", () => {
    expect(money.parse("1234.5678")).toEqual({ mantissa: 12345678n, scale: 4 })
    expect(money.parse("-0.001")).toEqual({ mantissa: -1n, scale: 3 })
    expect(money.parse("0")).toEqual({ mantissa: 0n, scale: 0 })
    expect(money.parse("+5")).toEqual({ mantissa: 5n, scale: 0 })
    expect(money.parse(".5")).toEqual({ mantissa: 5n, scale: 1 })
    expect(money.parse("0.00")).toEqual({ mantissa: 0n, scale: 2 })
    expect(money.parse("007.10")).toEqual({ mantissa: 710n, scale: 2 })
  })

  it("keeps full precision on strings no float could hold", () => {
    // 25 significant digits: parseFloat would silently mangle this.
    expect(money.parse("1234567890123456789.0123456")).toEqual({
      mantissa: 12345678901234567890123456n,
      scale: 7,
    })
    expect(money.parse("0.1").mantissa + money.parse("0.2").mantissa).toBe(3n)
  })

  it("scale never goes negative for positive exponents", () => {
    expect(money.parse("1e6")).toEqual({ mantissa: 1000000n, scale: 0 })
    expect(money.parse("1.5e3")).toEqual({ mantissa: 1500n, scale: 0 })
    expect(money.parse("-2E2")).toEqual({ mantissa: -200n, scale: 0 })
  })

  it("negative exponents become scale", () => {
    expect(money.parse("1e-6")).toEqual({ mantissa: 1n, scale: 6 })
    expect(money.parse("1.5e-3")).toEqual({ mantissa: 15n, scale: 4 })
  })

  it("throws on garbage rather than guessing", () => {
    for (const bad of [
      "",
      " ",
      " 1",
      "1 ",
      "abc",
      "1.2.3",
      "1e",
      "e5",
      "NaN",
      "Infinity",
      "-Infinity",
      "0x10",
      "1,000",
      "--1",
      "1_000",
      ".",
      "1e1001",
    ]) {
      expect(() => money.parse(bad), `expected ${JSON.stringify(bad)} to throw`).toThrow()
    }
  })

  it("refuses a non-string, which is how a float sneaks in", () => {
    // @ts-expect-error a venue number must never reach parse
    expect(() => money.parse(1.5)).toThrow(/expected a string/)
  })

  it("widens to an explicit scale but refuses to round implicitly", () => {
    expect(money.parse("1.5", 4)).toEqual({ mantissa: 15000n, scale: 4 })
    expect(money.parse("1.2300", 2)).toEqual({ mantissa: 123n, scale: 2 })
    expect(() => money.parse("1.2345", 2)).toThrow(/does not fit scale 2 exactly/)
    expect(() => money.parse("1.5", -2)).toThrow(/scale must be >= 0/)
  })
})

describe("format", () => {
  it("never strips trailing zeros — scale is part of the value", () => {
    expect(money.format(d(150n, 2))).toBe("1.50")
    expect(money.format(d(15n, 1))).toBe("1.5")
    expect(money.format(d(0n, 4))).toBe("0.0000")
    expect(money.format(d(5n, 0))).toBe("5")
  })

  it("round-trips 1.50 and 1.5 as distinct values", () => {
    const a = money.parse("1.50")
    const b = money.parse("1.5")
    expect(money.format(a)).toBe("1.50")
    expect(money.format(b)).toBe("1.5")
    expect(a).not.toEqual(b)
    expect(money.eq(a, b)).toBe(true) // numerically equal, structurally distinct
  })

  it("uses no exponent notation at either extreme", () => {
    expect(money.format(d(1n, 20))).toBe("0.00000000000000000001")
    expect(money.format(d(10n ** 25n, 0))).toBe("10000000000000000000000000")
  })

  it("never emits negative zero", () => {
    expect(money.format(d(0n, 2))).toBe("0.00")
    expect(money.format(money.neg(d(0n, 2)))).toBe("0.00")
    expect(money.format(money.rescale(money.parse("-0.004"), 2, "trunc"))).toBe("0.00")
    expect(money.format(money.mul(money.parse("-1"), d(0n, 2), 2, "trunc"))).toBe("0.00")
  })

  it("normalises a -0 scale so values stay structurally comparable", () => {
    expect(Object.is(money.fromBigInt(5n, -0).scale, 0)).toBe(true)
  })
})

describe("display", () => {
  it("prettifies for humans only", () => {
    expect(money.display(d(150n, 2))).toBe("1.5")
    expect(money.display(d(0n, 4))).toBe("0")
    expect(money.display(d(123456789n, 2))).toBe("1,234,567.89")
    expect(money.display(d(-123456789n, 2))).toBe("-1,234,567.89")
    expect(money.display(d(5n, 3))).toBe("0.005")
  })

  it("rounds half-even to maxDecimals and never shows -0", () => {
    expect(money.display(money.parse("1.005"), 2)).toBe("1")
    expect(money.display(money.parse("1.015"), 2)).toBe("1.02")
    expect(money.display(money.parse("-0.004"), 2)).toBe("0")
    expect(money.display(money.parse("1.23456"), 8)).toBe("1.23456")
  })
})

describe("add / sub", () => {
  it("widens to the larger scale exactly", () => {
    expect(money.add(money.parse("1.5"), money.parse("2.25"))).toEqual({
      mantissa: 375n,
      scale: 2,
    })
    expect(money.sub(money.parse("1"), money.parse("0.0001"))).toEqual({
      mantissa: 9999n,
      scale: 4,
    })
  })

  it("does what 0.1 + 0.2 cannot do in floats", () => {
    expect(money.format(money.add(money.parse("0.1"), money.parse("0.2")))).toBe("0.3")
  })
})

describe("rounding direction", () => {
  it("trunc is toward zero, which is not floor for negatives", () => {
    const negative = money.parse("-1.5")
    expect(money.format(money.rescale(negative, 0, "trunc"))).toBe("-1")
    expect(money.format(money.rescale(negative, 0, "floor"))).toBe("-2")
    expect(money.format(money.rescale(negative, 0, "ceil"))).toBe("-1")
    expect(money.format(money.rescale(negative, 0, "half-even"))).toBe("-2")

    const positive = money.parse("1.5")
    expect(money.format(money.rescale(positive, 0, "trunc"))).toBe("1")
    expect(money.format(money.rescale(positive, 0, "floor"))).toBe("1")
    expect(money.format(money.rescale(positive, 0, "ceil"))).toBe("2")
    expect(money.format(money.rescale(positive, 0, "half-even"))).toBe("2")
  })

  it("half-even breaks ties to the even neighbour, in both signs", () => {
    const at = (s: string) => money.format(money.rescale(money.parse(s), 0, "half-even"))
    expect(at("0.5")).toBe("0")
    expect(at("1.5")).toBe("2")
    expect(at("2.5")).toBe("2")
    expect(at("3.5")).toBe("4")
    expect(at("-0.5")).toBe("0")
    expect(at("-1.5")).toBe("-2")
    expect(at("-2.5")).toBe("-2")
    expect(at("-3.5")).toBe("-4")
  })

  it("half-even only ties on an exact half", () => {
    const at = (s: string) => money.format(money.rescale(money.parse(s), 0, "half-even"))
    expect(at("2.5001")).toBe("3")
    expect(at("2.4999")).toBe("2")
    expect(at("-2.5001")).toBe("-3")
  })

  it("widening ignores the rounding mode because nothing is lost", () => {
    for (const mode of ["trunc", "floor", "ceil", "half-even"] as const) {
      expect(money.rescale(money.parse("-1.5"), 4, mode)).toEqual({
        mantissa: -15000n,
        scale: 4,
      })
    }
  })
})

describe("mul", () => {
  it("multiplies exactly, then rounds once", () => {
    expect(money.format(money.mul(money.parse("1.5"), money.parse("2.5"), 2, "trunc"))).toBe(
      "3.75",
    )
    expect(money.format(money.mul(money.parse("0.1"), money.parse("0.1"), 4, "trunc"))).toBe(
      "0.0100",
    )
  })

  it("does not double-round through an intermediate scale", () => {
    // 1.4451 -> scale 2 is 1.45 directly, but 1.45 via scale 3 (1.445, tie to
    // even) would be 1.44. Seeing 1.45 proves there is only one rounding step.
    const a = money.parse("1.4451")
    const one = money.parse("1")
    expect(money.format(money.mul(a, one, 2, "half-even"))).toBe("1.45")
  })

  it("honours the requested scale even when widening", () => {
    expect(money.mul(money.parse("2"), money.parse("3"), 4, "trunc")).toEqual({
      mantissa: 60000n,
      scale: 4,
    })
  })

  it("keeps sign direction under trunc and floor", () => {
    const a = money.parse("-1.5")
    const b = money.parse("1.5")
    expect(money.format(money.mul(a, b, 0, "trunc"))).toBe("-2")
    expect(money.format(money.mul(a, b, 0, "floor"))).toBe("-3")
  })
})

describe("div", () => {
  it("throws on division by zero at any scale", () => {
    expect(() => money.div(money.parse("1"), money.parse("0"), 4, "trunc")).toThrow(
      /division by zero/,
    )
    expect(() => money.div(money.parse("1"), money.parse("0.0000"), 4, "trunc")).toThrow(
      /division by zero/,
    )
    expect(() => money.div(money.parse("0"), money.parse("0"), 4, "trunc")).toThrow(
      /division by zero/,
    )
  })

  it("rounds in the requested direction", () => {
    const one = money.parse("1")
    const three = money.parse("3")
    expect(money.format(money.div(one, three, 4, "trunc"))).toBe("0.3333")
    expect(money.format(money.div(one, three, 4, "ceil"))).toBe("0.3334")
    expect(money.format(money.div(one, three, 4, "floor"))).toBe("0.3333")
    expect(money.format(money.div(money.neg(one), three, 4, "trunc"))).toBe("-0.3333")
    expect(money.format(money.div(money.neg(one), three, 4, "floor"))).toBe("-0.3334")
    expect(money.format(money.div(money.neg(one), three, 4, "ceil"))).toBe("-0.3333")
  })

  it("handles mixed scales", () => {
    expect(money.format(money.div(money.parse("1.00"), money.parse("0.25"), 2, "trunc"))).toBe(
      "4.00",
    )
    expect(money.format(money.div(money.parse("100"), money.parse("3"), 0, "trunc"))).toBe("33")
  })
})

describe("quantizeToStep", () => {
  it("is exact where float division loses a unit in the last place", () => {
    // 0.3 / 0.1 is 2.9999999999999996 in floats, which truncates to 2 and
    // quantizes 0.3 down to 0.2. In bigint it is exactly 3.
    expect(money.format(money.quantizeToStep(money.parse("0.3"), money.parse("0.1"), "trunc"))).toBe(
      "0.3",
    )
    expect(
      money.format(money.quantizeToStep(money.parse("1.005"), money.parse("0.001"), "trunc")),
    ).toBe("1.005")
    expect(
      money.format(money.quantizeToStep(money.parse("70.35"), money.parse("0.05"), "trunc")),
    ).toBe("70.35")
  })

  it("carries max(a.scale, step.scale)", () => {
    expect(money.quantizeToStep(money.parse("1.2345"), money.parse("0.01"), "trunc")).toEqual({
      mantissa: 12300n,
      scale: 4,
    })
    expect(money.quantizeToStep(money.parse("7"), money.parse("0.25"), "trunc")).toEqual({
      mantissa: 700n,
      scale: 2,
    })
  })

  it("rounds a buy limit down and a sell limit up (docs/02 §5)", () => {
    const price = money.parse("1.2345")
    const tick = money.parse("0.01")
    expect(money.format(money.quantizeToStep(price, tick, "floor"))).toBe("1.2300")
    expect(money.format(money.quantizeToStep(price, tick, "ceil"))).toBe("1.2400")
  })

  it("sizes toward zero on both sides under trunc", () => {
    const step = money.parse("0.1")
    expect(money.format(money.quantizeToStep(money.parse("1.99"), step, "trunc"))).toBe("1.90")
    expect(money.format(money.quantizeToStep(money.parse("-1.99"), step, "trunc"))).toBe("-1.90")
    expect(money.format(money.quantizeToStep(money.parse("-1.99"), step, "floor"))).toBe("-2.00")
  })

  it("refuses a zero or negative step", () => {
    expect(() => money.quantizeToStep(money.parse("1"), money.parse("0"), "trunc")).toThrow(
      /step must be > 0/,
    )
    expect(() => money.quantizeToStep(money.parse("1"), money.parse("-0.1"), "trunc")).toThrow(
      /step must be > 0/,
    )
  })

  it("handles a step larger than the value", () => {
    expect(money.format(money.quantizeToStep(money.parse("0.4"), money.parse("1"), "trunc"))).toBe(
      "0.0",
    )
    expect(money.format(money.quantizeToStep(money.parse("0.4"), money.parse("1"), "ceil"))).toBe(
      "1.0",
    )
  })
})

describe("bpsOf", () => {
  it("computes basis points of a value", () => {
    expect(money.format(money.bpsOf(money.parse("100"), 50, 2, "trunc"))).toBe("0.50")
    expect(money.format(money.bpsOf(money.parse("100"), 10000, 2, "trunc"))).toBe("100.00")
    expect(money.format(money.bpsOf(money.parse("100"), 0, 2, "trunc"))).toBe("0.00")
    expect(money.format(money.bpsOf(money.parse("-250.00"), 25, 4, "trunc"))).toBe("-0.6250")
  })

  it("rounds in the requested direction", () => {
    const price = money.parse("1234.5678")
    expect(money.format(money.bpsOf(price, 1, 4, "trunc"))).toBe("0.1234")
    expect(money.format(money.bpsOf(price, 1, 4, "ceil"))).toBe("0.1235")
    expect(money.format(money.bpsOf(money.neg(price), 1, 4, "trunc"))).toBe("-0.1234")
    expect(money.format(money.bpsOf(money.neg(price), 1, 4, "floor"))).toBe("-0.1235")
  })

  it("refuses a fractional bps, which would mean a float in the maths", () => {
    expect(() => money.bpsOf(money.parse("100"), 2.5, 2, "trunc")).toThrow(/safe integer/)
    expect(() => money.bpsOf(money.parse("100"), Number.NaN, 2, "trunc")).toThrow(/safe integer/)
  })
})

describe("diffBps", () => {
  it("is signed and measured against the reference", () => {
    expect(money.diffBps(money.parse("100"), money.parse("101"))).toBe(100)
    expect(money.diffBps(money.parse("100"), money.parse("99"))).toBe(-100)
    expect(money.diffBps(money.parse("100"), money.parse("100"))).toBe(0)
    expect(money.diffBps(money.parse("100.00"), money.parse("99.99"))).toBe(-1)
  })

  it("rounds toward zero on both signs", () => {
    expect(money.diffBps(money.parse("3"), money.parse("4"))).toBe(3333)
    expect(money.diffBps(money.parse("3"), money.parse("2"))).toBe(-3333)
    expect(money.diffBps(money.parse("10000"), money.parse("10000.9"))).toBe(0)
  })

  it("compares across scales without a float in the middle", () => {
    expect(money.diffBps(money.parse("1.00000000"), money.parse("1.0001"))).toBe(1)
  })

  it("throws when the reference is zero", () => {
    expect(() => money.diffBps(money.parse("0.00"), money.parse("1"))).toThrow(/reference is zero/)
  })

  it("returns a plain integer, never a float artefact", () => {
    const bps = money.diffBps(money.parse("0.1"), money.parse("0.3"))
    expect(bps).toBe(20000)
    expect(Number.isInteger(bps)).toBe(true)
  })
})

describe("comparisons and sign", () => {
  it("compares numerically across scales", () => {
    expect(money.cmp(money.parse("1.50"), money.parse("1.5"))).toBe(0)
    expect(money.cmp(money.parse("1.5"), money.parse("1.50001"))).toBe(-1)
    expect(money.cmp(money.parse("-1"), money.parse("-2"))).toBe(1)
    expect(money.eq(money.parse("1.50"), money.parse("1.5"))).toBe(true)
    expect(money.lt(money.parse("-2"), money.parse("-1"))).toBe(true)
    expect(money.lte(money.parse("1.50"), money.parse("1.5"))).toBe(true)
    expect(money.gt(money.parse("0.0001"), money.parse("0"))).toBe(true)
    expect(money.gte(money.parse("1.50"), money.parse("1.5"))).toBe(true)
  })

  it("treats zero as neither negative nor signed", () => {
    expect(money.isZero(d(0n, 8))).toBe(true)
    expect(money.isZero(money.parse("-0.000"))).toBe(true)
    expect(money.isNegative(money.parse("-0.000"))).toBe(false)
    expect(money.isNegative(money.parse("-0.001"))).toBe(true)
    expect(money.isNegative(money.parse("0"))).toBe(false)
    expect(money.format(money.abs(money.parse("-0.001")))).toBe("0.001")
    expect(money.format(money.neg(money.parse("0.00")))).toBe("0.00")
  })

  it("min and max keep the winner's own scale", () => {
    expect(money.min(money.parse("1.50"), money.parse("2"))).toEqual({ mantissa: 150n, scale: 2 })
    expect(money.max(money.parse("1.50"), money.parse("2"))).toEqual({ mantissa: 2n, scale: 0 })
    expect(money.min(money.parse("1.50"), money.parse("1.5"))).toEqual({ mantissa: 150n, scale: 2 })
  })
})

describe("constructors", () => {
  it("fromInt takes a value, not a mantissa", () => {
    expect(money.format(money.fromInt(5))).toBe("5")
    expect(money.format(money.fromInt(5, 2))).toBe("5.00")
    expect(money.format(money.fromInt(-3, 4))).toBe("-3.0000")
    expect(money.fromInt(-0, 2)).toEqual({ mantissa: 0n, scale: 2 })
  })

  it("fromBigInt takes the mantissa", () => {
    expect(money.format(money.fromBigInt(500n, 2))).toBe("5.00")
    expect(() => money.fromBigInt(1n, -1)).toThrow(/scale must be >= 0/)
    expect(() => money.fromBigInt(1n, 1.5)).toThrow(/scale must be an integer/)
    expect(() => money.fromBigInt(1n, 100000)).toThrow(/scale must be <=/)
  })

  it("rejects an unsafe integer rather than losing digits", () => {
    expect(() => money.fromInt(Number.MAX_SAFE_INTEGER + 2)).toThrow(/safe integer/)
    expect(() => money.fromInt(1.5)).toThrow(/safe integer/)
  })

  it("returns frozen values", () => {
    expect(Object.isFrozen(money.parse("1.5"))).toBe(true)
    expect(Object.isFrozen(money.add(money.parse("1"), money.parse("2")))).toBe(true)
  })
})
