import { describe, expect, it } from "vitest"
import { isCopyable, roiCredit, scoreFrom, scoreParts, type ScoreInput } from "../score.js"

const base: ScoreInput = {
  roiMonth: 0.2,
  roiAll: 1,
  positiveWindows: [true, true, true],
  consistencyRatio: 0.7,
  activeWeeks: 20,
  maxDrawdownPct: 0.3,
  tradeCount: 100,
  topShare: 0.2,
}

describe("score", () => {
  it("never credits a loss and saturates large returns", () => {
    expect(roiCredit(-0.5)).toBe(0)
    expect(roiCredit(0)).toBe(0)
    expect(roiCredit(10)).toBeCloseTo(1, 5)
  })

  it("matches the documented formula on a worked example", () => {
    const p = scoreParts(base)
    // profitability = 0.4*(1-e^-2.5) + 0.3*(1-e^-0.5) + 0.3*1
    const prof = 0.4 * (1 - Math.exp(-2.5)) + 0.3 * (1 - Math.exp(-0.5)) + 0.3
    expect(p.profitability).toBeCloseTo(prof, 10)
    expect(p.consistency).toBeCloseTo(0.7, 10) // 20 weeks >= 8: fully trusted
    expect(p.risk).toBeCloseTo(1 - 0.3 / 0.9, 10)
    expect(p.sample).toBe(1)
    const expected = Math.round(100 * (0.4 * prof + 0.33 * 0.7 + 0.27 * (1 - 0.3 / 0.9)) * 1 * 1)
    expect(scoreFrom(p)).toBe(expected)
  })

  it("lets thin evidence cap a score instead of nudging it", () => {
    const p = scoreParts({ ...base, tradeCount: 6 })
    const unrounded = 100 * (0.4 * p.profitability + 0.33 * p.consistency + 0.27 * p.risk)
    // evidence = 0.6 + 0.4 * (6/60) = 0.64
    expect(scoreFrom(p)).toBe(Math.round(unrounded * 0.64))
    expect(scoreFrom(p)).toBeLessThan(0.66 * scoreFrom(scoreParts(base)))
  })

  it("does not let a two-week hot streak max out consistency", () => {
    const p = scoreParts({ ...base, consistencyRatio: 1, activeWeeks: 2 })
    // trust 2/8: 0.25*1 + 0.75*0.5*1 = 0.625
    expect(p.consistency).toBeCloseTo(0.625, 10)
  })

  it("penalises one-trade wonders and treats unknown drawdown as bad", () => {
    expect(scoreParts({ ...base, topShare: 0.7 }).concentrationPenalty).toBe(0.6)
    expect(scoreParts({ ...base, topShare: 0.5 }).concentrationPenalty).toBe(0.8)
    expect(scoreParts({ ...base, maxDrawdownPct: null }).risk).toBe(0.3)
  })

  it("marks structural flags as uncopyable but not low_sample or one_big_win", () => {
    expect(isCopyable(["scalper"])).toBe(false)
    expect(isCopyable(["short_horizon_markets"])).toBe(false)
    expect(isCopyable(["low_sample", "one_big_win"])).toBe(true)
  })
})
