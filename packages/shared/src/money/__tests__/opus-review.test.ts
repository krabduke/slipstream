/** Opus adversarial review of W1. Hand-computed expectations, independent of
 *  the implementer's own test suite. Delete or keep — it costs nothing to keep. */
import { describe, expect, it } from "vitest"
import { money as m } from "../ops.js"

const v = (s: string) => m.format(s.startsWith("~") ? m.parse(s.slice(1)) : m.parse(s))

describe("Opus review — safety-critical rounding", () => {
  it("a buy limit never rounds UP (would make the order more aggressive)", () => {
    // 64769.37 on a 0.5 tick. Buy must land at 64769.0, never 64769.5.
    const q = m.quantizeToStep(m.parse("64769.37"), m.parse("0.5"), "floor")
    expect(m.format(q)).toBe("64769.00")
  })

  it("a sell limit never rounds DOWN", () => {
    const q = m.quantizeToStep(m.parse("64769.37"), m.parse("0.5"), "ceil")
    expect(m.format(q)).toBe("64769.50")
  })

  it("a NEGATIVE size truncates toward zero, not toward -inf", () => {
    // trunc on -1.2379 at lot 0.001 must be -1.237, NOT -1.238.
    // Getting this backwards sizes a short LARGER than intended.
    const q = m.quantizeToStep(m.parse("-1.2379"), m.parse("0.001"), "trunc")
    expect(m.format(q)).toBe("-1.2370")
  })

  it("floor on a negative DOES go toward -inf (distinct from trunc)", () => {
    const q = m.quantizeToStep(m.parse("-1.2379"), m.parse("0.001"), "floor")
    expect(m.format(q)).toBe("-1.2380")
  })

  it("0.3 quantized by 0.1 stays 0.3 (the classic float failure)", () => {
    const q = m.quantizeToStep(m.parse("0.3"), m.parse("0.1"), "trunc")
    expect(m.cmp(q, m.parse("0.3"))).toBe(0)
  })

  it("trailing zeros survive a parse/format round trip", () => {
    expect(m.format(m.parse("1.50"))).toBe("1.50")
    expect(m.format(m.parse("1.5"))).toBe("1.5")
    expect(m.cmp(m.parse("1.50"), m.parse("1.5"))).toBe(0)
  })

  it("div by zero throws rather than returning a poisoned value", () => {
    expect(() => m.div(m.parse("1"), m.parse("0.00"), 2, "trunc")).toThrow()
  })

  it("the slippage gate's core comparison is exact", () => {
    // leader filled 64210, best ask 64769 -> 87 bps, which must exceed a 50 bps cap.
    const bps = m.diffBps(m.parse("64210"), m.parse("64769"))
    expect(bps).toBe(87)
    expect(bps > 50).toBe(true)
  })

  it("diffBps is signed and truncates toward zero on the negative side", () => {
    expect(m.diffBps(m.parse("64769"), m.parse("64210"))).toBe(-86)
  })

  it("no float ever reaches a value: 0.1 + 0.2 is exactly 0.3", () => {
    expect(m.format(m.add(m.parse("0.1"), m.parse("0.2")))).toBe("0.3")
  })
})
