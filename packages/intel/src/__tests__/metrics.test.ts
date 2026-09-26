import { describe, expect, it } from "vitest"
import {
  consistency,
  maxDrawdown,
  roundTrips,
  timeWeighted,
  tripStats,
  valueAt,
  weeklyChanges,
  weeklySharpe,
  type PerpFill,
} from "../metrics.js"

const H = 3_600_000
const D = 24 * H

describe("maxDrawdown", () => {
  it("measures the worst peak-to-trough fall, not the last one", () => {
    // pnl: 0 -> 100 -> 40 (fall 60) -> 150 -> 120 (fall 30)
    const pnl = [0, 100, 40, 150, 120].map((v, i) => ({ t: i * D, v }))
    expect(maxDrawdown(pnl).abs).toBe(60)
  })

  it("expresses the fall relative to capital at the peak", () => {
    const pnl = [0, 100, 40].map((v, i) => ({ t: i * D, v }))
    const equity = [1000, 1100, 1040].map((v, i) => ({ t: i * D, v }))
    // peak at t=1D with capital 1100; fall 60 -> 60/1100
    expect(maxDrawdown(pnl, (t) => valueAt(equity, t)).pct).toBeCloseTo(60 / 1100, 10)
  })

  it("reports zero for a series that only rises", () => {
    const pnl = [0, 1, 2].map((v, i) => ({ t: i, v }))
    expect(maxDrawdown(pnl, () => 10)).toEqual({ abs: 0, pct: 0 })
  })
})

describe("timeWeighted", () => {
  it("is not fooled by a deposit inside an interval", () => {
    // $1,377 at the start, $90k deposited mid-interval, $10,176 lost: capital
    // deployed is 91,250 + 10,176 = 101,426, so the interval return is -10.03%.
    const equity = [{ t: 0, v: 1_377 }, { t: 1, v: 91_250 }]
    const pnl = [{ t: 0, v: 0 }, { t: 1, v: -10_176 }]
    const r = timeWeighted(equity, pnl)
    expect(r.totalReturn).toBeCloseTo(-10_176 / 101_426, 10)
    expect(r.maxDrawdown).toBeCloseTo(10_176 / 101_426, 10)
  })

  it("compounds interval returns and ignores tiny starting capital", () => {
    // interval 1 starts at $500 (< $1k floor): skipped. interval 2: +10% on 1,000. interval 3: -5% on 1,100.
    const equity = [500, 1_000, 1_100, 1_045].map((v, t) => ({ t, v }))
    const pnl = [0, 500, 600, 545].map((v, t) => ({ t, v }))
    const r = timeWeighted(equity, pnl)
    expect(r.totalReturn).toBeCloseTo(1.1 * 0.95 - 1, 10)
    expect(r.maxDrawdown).toBeCloseTo(0.05, 10)
  })
})

describe("weekly consistency", () => {
  it("counts profitable weeks among active weeks", () => {
    // Mon 2026-09-07 onwards, one point per week: +10, -5, +20, 0 (dormant)
    const start = Date.UTC(2026, 8, 7, 12)
    const cum = [0, 10, 5, 25, 25].map((v, i) => ({ t: start + i * 7 * D, v }))
    const changes = weeklyChanges(cum)
    expect(changes).toEqual([0, 10, -5, 20, 0])
    expect(consistency(changes)).toEqual({ profitable: 2, total: 3, ratio: 2 / 3 })
  })

  it("needs four weeks before it will quote a Sharpe ratio", () => {
    expect(weeklySharpe([1, 2, 3])).toBeNull()
    // mean 2.5, sample sd of [1,2,3,4] = sqrt(5/3)
    expect(weeklySharpe([1, 2, 3, 4])).toBeCloseTo(2.5 / Math.sqrt(5 / 3), 10)
  })
})

describe("roundTrips", () => {
  const fill = (coin: string, time: number, startPosition: number, delta: number, closedPnl = 0, fee = 0): PerpFill => ({
    coin, time, startPosition, delta, closedPnl, fee,
  })

  it("pairs open-to-flat trips, adds partial closes, and nets fees", () => {
    const fills = [
      fill("BTC", 0, 0, 2, 0, 1), // open long 2
      fill("BTC", H, 2, -1, 50, 1), // partial close +50
      fill("BTC", 3 * H, 1, -1, 30, 1), // close +30
    ]
    const trips = roundTrips(fills)
    expect(trips).toHaveLength(1)
    // every fill's fee is a cost of the trip, the entry fee included: 50 + 30 - 3 = 77
    expect(trips[0]).toEqual({ coin: "BTC", openedAt: 0, closedAt: 3 * H, pnl: 77 })
  })

  it("splits a flip into a closed trip and a new one", () => {
    const fills = [
      fill("ETH", 0, 0, 1),
      fill("ETH", H, 1, -3, 20, 0), // long 1 -> short 2: closes (+20), opens short
      fill("ETH", 2 * H, -2, 2, -5, 0), // closes short (-5)
    ]
    expect(roundTrips(fills).map((t) => [t.openedAt, t.closedAt, t.pnl])).toEqual([
      [0, H, 20],
      [H, 2 * H, -5],
    ])
  })

  it("drops a trip whose opening fill predates the window", () => {
    // first fill we can see already starts from a position of 5
    const fills = [fill("SOL", 0, 5, -5, 40), fill("SOL", H, 0, 1), fill("SOL", 2 * H, 1, -1, -3)]
    expect(roundTrips(fills).map((t) => t.pnl)).toEqual([-3])
  })
})

describe("tripStats", () => {
  it("computes win rate, holds, frequency and concentration from closed trips", () => {
    const trips = [
      { coin: "A", openedAt: 0, closedAt: 2 * H, pnl: 30 },
      { coin: "A", openedAt: D, closedAt: D + 4 * H, pnl: -10 },
      { coin: "B", openedAt: 2 * D, closedAt: 2 * D + 6 * H, pnl: 90 },
    ]
    const s = tripStats(trips)
    expect(s.count).toBe(3)
    expect(s.winRate).toBeCloseTo(2 / 3, 10)
    expect(s.medianHoldSecs).toBe(4 * 3600)
    expect(s.avgHoldSecs).toBe(4 * 3600)
    // span: first open 0 to last close 2D+6H = 2.25 days
    expect(s.perDay).toBeCloseTo(3 / 2.25, 10)
    // best 90 of gains 120
    expect(s.bestTripShare).toBeCloseTo(0.75, 10)
  })
})
