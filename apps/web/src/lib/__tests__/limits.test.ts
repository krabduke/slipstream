import { describe, expect, it } from "vitest"
import { DEFAULTS, fromRow, loosens } from "../limits"

describe("limits", () => {
  it("treats any raised value as loosening", () => {
    expect(loosens({ ...DEFAULTS, leverage: 4 }, DEFAULTS)).toBe(true)
    expect(loosens({ ...DEFAULTS, dailyLossPct: 5, perPositionUsd: 500 }, DEFAULTS)).toBe(false)
    expect(loosens({ ...DEFAULTS, leverage: 2, exposurePct: 60 }, DEFAULTS)).toBe(true)
  })
  it("converts stored fractions to percentages", () => {
    expect(fromRow(undefined)).toEqual(DEFAULTS)
    expect(
      fromRow({ maxNotionalPerPosition: "1000", maxPositionPctEquity: "0.2", maxTotalExposure: "0.5", maxLeverage: "3", dailyLossLimit: "0.1" }),
    ).toEqual(DEFAULTS)
  })
})
