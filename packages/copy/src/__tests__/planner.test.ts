import { describe, expect, it } from "vitest"
import { asMarketId, asTimestamp, money } from "@slipstream/shared"
import type { Address, Decimal, LeaderRef, MarketId, SizingMode, SubscriptionId, UserId } from "@slipstream/shared"
import type { Position } from "@slipstream/venues"
import { plan, sizeFor, STALE_REF_AGE_MS } from "../index.js"
import type { PlanContext } from "../types.js"

const d = (s: string) => money.parse(s)
const NOW = asTimestamp(1_790_000_000_000)
const BTC = asMarketId("BTC")
const ETH = asMarketId("ETH")
const LEADER = "0x7a3f000000000000000000000000000000000000" as Address

const pos = (marketId: MarketId, side: "long" | "short", size: string, entry = "64000"): Position => ({
  venue: "hyperliquid",
  marketId,
  side,
  size: d(size),
  entryPrice: d(entry),
  notional: money.mul(d(size), d(entry), 2, "trunc"),
  unrealizedPnl: d("0"),
  leverage: d("3"),
  liquidationPrice: null,
})

const fill = (price: string, ageMs = 1_000): LeaderRef => ({
  leaderAddress: LEADER,
  leaderFillPrice: d(price),
  leaderFillTs: asTimestamp(NOW - ageMs),
})

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  now: NOW,
  userId: "u1" as UserId,
  subscriptionId: "s1" as SubscriptionId,
  venue: "hyperliquid",
  sizing: { mode: "equity_ratio", multiplier: d("1") },
  leaderPositions: [],
  followerPositions: [],
  leaderEquity: d("1000000"),
  followerEquity: d("10000"),
  toleranceBand: d("10"),
  markPrices: new Map([[BTC, d("64000")], [ETH, d("3000")]]),
  leaderFills: new Map([[BTC, fill("64000")]]),
  leaderAddress: LEADER,
  ...over,
})

const f = (x: Decimal | null) => (x === null ? null : money.format(money.rescale(x, 4, "trunc")))

describe("sizeFor", () => {
  it("scales by equity ratio and fails closed without leader equity", () => {
    const r = sizeFor(d("10"), { mode: "equity_ratio", multiplier: d("1") }, d("1000000"), d("10000"), null)
    expect(r.ok && f(r.size)).toBe("0.1000")
    expect(sizeFor(d("10"), { mode: "equity_ratio", multiplier: d("1") }, null, d("10000"), null)).toEqual({
      ok: false,
      reason: "leader_equity_unavailable",
    })
  })

  it("sizes fixed notional and percent of equity from the mark", () => {
    const fixed = sizeFor(d("3"), { mode: "fixed_notional", notional: d("500") }, null, null, d("50"))
    expect(fixed.ok && f(fixed.size)).toBe("10.0000")
    const pctEq = sizeFor(d("3"), { mode: "percent_equity", percent: d("5") }, null, d("10000"), d("50"))
    expect(pctEq.ok && f(pctEq.size)).toBe("10.0000") // 5% of 10k = 500 / 50
  })

  it("never sizes a flat leader into a position", () => {
    const sizing: SizingMode = { mode: "fixed_notional", notional: d("500") }
    const r = sizeFor(d("0"), sizing, null, null, d("50"))
    expect(r.ok && money.isZero(r.size)).toBe(true)
  })
})

describe("plan", () => {
  it("opens a proportional position with the leader's fill as the reference", () => {
    const p = plan(ctx({ leaderPositions: [pos(BTC, "long", "10")] }))
    expect(p.exits).toHaveLength(0)
    expect(p.trades).toHaveLength(1)
    const t = p.trades[0]!
    expect([t.side, f(t.size), t.leaderRef?.leaderFillTs]).toEqual(["buy", "0.1000", NOW - 1000])
  })

  it("follows the leader out even when equity is unreadable", () => {
    const p = plan(ctx({ leaderEquity: null, followerPositions: [pos(BTC, "long", "0.1")] }))
    expect(p.exits.map((e) => [e.marketId, e.size, e.reason])).toEqual([[BTC, null, "leader_closed"]])
    expect(p.trades).toHaveLength(0)
  })

  it("refuses to open when equity is unreadable, and says why", () => {
    const p = plan(ctx({ leaderEquity: null, leaderPositions: [pos(BTC, "long", "10")] }))
    expect(p.trades).toHaveLength(0)
    expect(p.skips.map((s) => s.reason)).toEqual(["leader_equity_unavailable"])
  })

  it("reduces proportionally when the leader reduces", () => {
    const p = plan(ctx({ leaderPositions: [pos(BTC, "long", "5")], followerPositions: [pos(BTC, "long", "0.1")] }))
    expect(p.trades).toHaveLength(0)
    expect(p.exits.map((e) => [e.reason, f(e.size)])).toEqual([["leader_reduced", "0.0500"]])
  })

  it("closes then reopens on the other side when the leader flips", () => {
    const p = plan(ctx({ leaderPositions: [pos(BTC, "short", "10")], followerPositions: [pos(BTC, "long", "0.1")] }))
    expect(p.exits.map((e) => [e.size, e.reason])).toEqual([[null, "leader_reduced"]])
    expect(p.trades.map((t) => [t.side, f(t.size)])).toEqual([["sell", "0.1000"]])
  })

  it("ignores drift inside the tolerance band", () => {
    // target 0.1; band = max($10 / 64000, 2% of 0.1) = 0.002; drift 0.001
    const p = plan(ctx({ leaderPositions: [pos(BTC, "long", "10")], followerPositions: [pos(BTC, "long", "0.099")] }))
    expect(p.trades).toHaveLength(0)
    expect(p.exits).toHaveLength(0)
    expect(p.skips.map((s) => s.reason)).toEqual(["below_tolerance_band"])
  })

  it("is idempotent, and gives a partial fill's remainder a new key", () => {
    const base = ctx({ leaderPositions: [pos(BTC, "long", "10")] })
    const a = plan(base).trades[0]!
    const b = plan(base).trades[0]!
    expect(b.idempotencyKey).toBe(a.idempotencyKey)
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
    const partial = plan({ ...base, followerPositions: [pos(BTC, "long", "0.04")] }).trades[0]!
    expect(f(partial.size)).toBe("0.0600")
    expect(partial.idempotencyKey).not.toBe(a.idempotencyKey)
  })

  it("stamps a stale reference on a position the leader opened before we watched", () => {
    const p = plan(ctx({ leaderPositions: [pos(ETH, "long", "100", "2900")] }))
    const t = p.trades[0]!
    expect(t.leaderRef?.leaderFillTs).toBe(NOW - STALE_REF_AGE_MS)
    expect(money.format(t.leaderRef!.leaderFillPrice)).toBe(money.format(d("2900")))
  })

  it("treats a Polymarket-style long-only reduction as an exit", () => {
    const YES = asMarketId("token-yes")
    const p = plan(
      ctx({
        venue: "polymarket",
        sizing: { mode: "fixed_multiplier", k: d("0.01") },
        markPrices: new Map([[YES, d("0.62")]]),
        leaderFills: new Map(),
        leaderPositions: [pos(YES, "long", "20000", "0.55")],
        followerPositions: [pos(YES, "long", "400", "0.55")],
      }),
    )
    // target 200 shares; hold 400 -> reduce 200
    expect(p.exits.map((e) => [e.reason, f(e.size)])).toEqual([["leader_reduced", "200.0000"]])
  })
})
