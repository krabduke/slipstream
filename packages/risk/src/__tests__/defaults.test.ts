/**
 * The defaults are a product decision, not a placeholder (docs/03 §4). A user
 * who wants to be reckless has to type the number themselves — which is a
 * safety property and an informed-consent property at once.
 *
 * Every value is asserted literally, because the failure mode of a "improved"
 * default is silent: nothing breaks, the user is simply running risk they never
 * agreed to.
 */
import { describe, expect, it } from "vitest"
import { money } from "@slipstream/shared"
import { DEFAULT_LIMITS, DEFAULT_MAX_SLIPPAGE_BPS } from "../defaults.js"

describe("DEFAULT_LIMITS", () => {
  it("is the table in docs/03 §4", () => {
    const limits = DEFAULT_LIMITS("hyperliquid")
    expect(money.format(limits.maxNotionalPerPosition)).toBe("1000.00")
    expect(money.format(limits.maxPositionPctEquity)).toBe("0.2000")
    expect(money.format(limits.maxTotalExposure)).toBe("0.5000")
    expect(money.format(limits.maxLeverage)).toBe("3.00")
    expect(limits.maxSignalAgeMs).toBe(5000)
    expect(money.format(limits.maxBookPct)).toBe("0.2000")
    expect(money.format(limits.dailyLossLimit)).toBe("0.1000")
    expect(money.format(limits.rateBudgetReserve)).toBe("0.2000")
  })

  it("takes slippage from the venue: 50 bps on Hyperliquid, 300 on Polymarket", () => {
    // 50 bps is generous on a perp and absurd on an outcome whose whole book
    // lives inside a few cents; one number for both venues is wrong twice.
    expect(DEFAULT_LIMITS("hyperliquid").maxSlippageBps).toBe(50)
    expect(DEFAULT_LIMITS("polymarket").maxSlippageBps).toBe(300)
    expect(DEFAULT_MAX_SLIPPAGE_BPS).toEqual({ hyperliquid: 50, polymarket: 300 })
  })

  it("differs between venues only in slippage and signal age", () => {
    const { maxSlippageBps: _hl, maxSignalAgeMs: hlAge, ...hyperliquid } = DEFAULT_LIMITS("hyperliquid")
    const { maxSlippageBps: _pm, maxSignalAgeMs: pmAge, ...polymarket } = DEFAULT_LIMITS("polymarket")
    expect(polymarket).toStrictEqual(hyperliquid)
    // Polymarket fills are polled, not pushed: 5s would refuse every copy.
    expect([hlAge, pmAge]).toEqual([5_000, 120_000])
  })

  it("hands out a fresh frozen object, never a shared one", () => {
    const a = DEFAULT_LIMITS("hyperliquid")
    const b = DEFAULT_LIMITS("hyperliquid")
    expect(a).not.toBe(b)
    expect(a).toStrictEqual(b)
    expect(Object.isFrozen(a)).toBe(true)
  })

  it("holds no floats — every limit is an exact decimal", () => {
    const limits = DEFAULT_LIMITS("polymarket")
    for (const value of [
      limits.maxNotionalPerPosition,
      limits.maxPositionPctEquity,
      limits.maxTotalExposure,
      limits.maxLeverage,
      limits.maxBookPct,
      limits.dailyLossLimit,
      limits.rateBudgetReserve,
    ]) {
      expect(typeof value.mantissa).toBe("bigint")
      expect(Number.isInteger(value.scale)).toBe(true)
      expect(money.parse(money.format(value))).toStrictEqual(value)
    }
  })
})
