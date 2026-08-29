/**
 * Composition: the order the gates run in, the short-circuit, the shape of the
 * `SkipDecision` that reaches the ledger, and purity.
 *
 * Order is contract, not detail (docs/03 §4). The reason that reaches the
 * activity feed is the FIRST true reason, and a user whose kill switch is on
 * must never be told their book was too thin.
 */
import { describe, expect, it, vi } from "vitest"
import { asTimestamp, money } from "@slipstream/shared"
import type { ReasonCode, TradeIntent } from "@slipstream/shared"
import { GATES, evaluateAll } from "../gates.js"
import type { RiskContext, RiskLimits } from "../types.js"
import {
  BTC,
  NOW,
  d,
  level,
  makeBook,
  makeCtx,
  makeIntent,
  makeLeaderRef,
  makeLimits,
  price,
  size,
  usd,
} from "./fixtures.js"

describe("GATES", () => {
  it("runs in the order docs/03 §4 declares", () => {
    expect(GATES.map((g) => g.name)).toEqual([
      "kill_switch",
      "market_filter",
      "signal_age",
      "slippage",
      "book_depth",
      "position_cap",
      "exposure_cap",
      "leverage_cap",
      "daily_loss",
      "rate_budget",
    ])
  })
})

interface Scenario {
  readonly intent: TradeIntent
  readonly ctx: RiskContext
}

const withLimits = (ctx: RiskContext, over: Partial<RiskLimits>): RiskContext => ({
  ...ctx,
  limits: { ...ctx.limits, ...over },
})

/** An intent that violates every gate at once. Each step below repairs exactly
 *  one violation, so the reason that surfaces next is proof of the ordering. */
const brokenEverywhere = (): Scenario => ({
  intent: makeIntent({
    size: size("50"),
    leaderRef: makeLeaderRef({
      leaderFillPrice: price("64210.0"),
      leaderFillTs: asTimestamp(NOW - 60_000),
    }),
  }),
  ctx: makeCtx({
    kill: { global: true, user: true, subscription: true },
    marketFilter: { type: "blocklist", markets: [BTC] },
    book: makeBook({ asks: [level("64769.0", "100")] }),
    followerEquity: usd("1000.00"),
    currentExposure: usd("45000.00"),
    realizedPnlToday: usd("-1500.00"),
    rateBudgetRemaining: 1,
    rateBudgetInitial: 100,
  }),
})

const steps: readonly {
  readonly repairs: string
  readonly fix: (s: Scenario) => Scenario
  readonly expected: ReasonCode | "approved"
}[] = [
  { repairs: "nothing yet", fix: (s) => s, expected: "kill_switch_global" },
  {
    repairs: "the global kill switch",
    fix: (s) => ({ ...s, ctx: { ...s.ctx, kill: { ...s.ctx.kill, global: false } } }),
    expected: "kill_switch_user",
  },
  {
    repairs: "the user kill switch",
    fix: (s) => ({ ...s, ctx: { ...s.ctx, kill: { ...s.ctx.kill, user: false } } }),
    expected: "kill_switch_subscription",
  },
  {
    repairs: "the subscription kill switch",
    fix: (s) => ({ ...s, ctx: { ...s.ctx, kill: { ...s.ctx.kill, subscription: false } } }),
    expected: "market_filtered",
  },
  {
    repairs: "the market filter",
    fix: (s) => ({ ...s, ctx: { ...s.ctx, marketFilter: { type: "allow_all" } } }),
    expected: "signal_stale",
  },
  {
    repairs: "the signal age",
    fix: (s) => ({
      ...s,
      intent: {
        ...s.intent,
        leaderRef: makeLeaderRef({
          leaderFillPrice: price("64210.0"),
          leaderFillTs: asTimestamp(NOW - 1000),
        }),
      },
    }),
    expected: "slippage_exceeded",
  },
  {
    repairs: "the price we would pay against the leader's fill",
    fix: (s) => ({
      ...s,
      intent: {
        ...s.intent,
        leaderRef: makeLeaderRef({
          leaderFillPrice: price("64769.0"),
          leaderFillTs: asTimestamp(NOW - 1000),
        }),
      },
    }),
    expected: "book_too_thin",
  },
  {
    repairs: "the order size against in-band depth",
    fix: (s) => ({ ...s, intent: { ...s.intent, size: size("0.02") } }),
    expected: "position_cap",
  },
  {
    repairs: "the absolute per-position notional cap",
    fix: (s) => ({ ...s, ctx: withLimits(s.ctx, { maxNotionalPerPosition: usd("100000.00") }) }),
    expected: "position_pct_equity_cap",
  },
  {
    repairs: "the share-of-equity cap",
    fix: (s) => ({ ...s, ctx: withLimits(s.ctx, { maxPositionPctEquity: d("10", 4) }) }),
    expected: "exposure_cap",
  },
  {
    repairs: "the total exposure cap",
    fix: (s) => ({ ...s, ctx: withLimits(s.ctx, { maxTotalExposure: d("100", 4) }) }),
    expected: "leverage_cap",
  },
  {
    repairs: "the leverage cap",
    fix: (s) => ({ ...s, ctx: withLimits(s.ctx, { maxLeverage: d("100", 2) }) }),
    expected: "daily_loss_limit",
  },
  {
    repairs: "today's realised loss",
    fix: (s) => ({ ...s, ctx: { ...s.ctx, realizedPnlToday: usd("0.00") } }),
    expected: "rate_budget_low",
  },
  {
    repairs: "the rate budget",
    fix: (s) => ({ ...s, ctx: { ...s.ctx, rateBudgetRemaining: 100 } }),
    expected: "approved",
  },
]

describe("evaluateAll", () => {
  it("short-circuits on the first failure, in the declared order", () => {
    let scenario = brokenEverywhere()
    const seen: string[] = []
    for (const step of steps) {
      scenario = step.fix(scenario)
      const result = evaluateAll(scenario.intent, scenario.ctx)
      seen.push(result.approved ? "approved" : result.skip.reason)
    }
    expect(seen).toEqual(steps.map((s) => s.expected))
  })

  it("writes a SkipDecision carrying the intent's identity and the numbers", () => {
    const intent = makeIntent()
    const result = evaluateAll(
      intent,
      makeCtx({ kill: { global: false, user: true, subscription: false } }),
    )
    expect(result.approved).toBe(false)
    if (result.approved) return
    expect(result.skip).toEqual({
      kind: "skip",
      userId: intent.userId,
      subscriptionId: intent.subscriptionId,
      venue: "hyperliquid",
      marketId: BTC,
      reason: "kill_switch_user",
      detail: {
        gate: "kill_switch",
        scope: "user",
        global: "false",
        user: "true",
        subscription: "false",
      },
      leaderRef: intent.leaderRef,
      createdAt: NOW,
    })
  })

  it("names the gate that declined, alongside its numbers", () => {
    const result = evaluateAll(makeIntent({ size: size("50") }), makeCtx())
    expect(result.approved).toBe(false)
    if (result.approved) return
    expect(result.skip.detail.gate).toBe("book_depth")
    expect(result.skip.detail.depthInBand).toBe("200.0000")
  })

  it("timestamps the skip from ctx.now, not from the clock", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2001-01-01T00:00:00.000Z"))
      const first = evaluateAll(makeIntent({ size: size("50") }), makeCtx())
      vi.setSystemTime(new Date("2099-12-31T23:59:59.000Z"))
      const second = evaluateAll(makeIntent({ size: size("50") }), makeCtx())
      expect(second).toStrictEqual(first)
      expect(first.approved).toBe(false)
      if (!first.approved) expect(first.skip.createdAt).toBe(NOW)
    } finally {
      vi.useRealTimers()
    }
  })

  it("is deterministic and does not mutate its arguments", () => {
    const intent = makeIntent({ size: size("0.02") })
    const ctx = makeCtx({ currentExposure: usd("4500.00") })
    const untouched = makeCtx({ currentExposure: usd("4500.00") })

    const first = evaluateAll(intent, ctx)
    const second = evaluateAll(intent, ctx)

    expect(second).toStrictEqual(first)
    expect(ctx).toStrictEqual(untouched)
    expect(intent).toStrictEqual(makeIntent({ size: size("0.02") }))
  })

  it("approves an intent that clears every gate, unchanged", () => {
    const intent = makeIntent()
    const result = evaluateAll(intent, makeCtx())
    expect(result).toEqual({ approved: true, intent })
  })

  it("runs the same gates in paper mode — only the executor differs (docs/03 §9)", () => {
    const intent = makeIntent({ size: size("50") })
    const live = evaluateAll(intent, makeCtx({ isPaper: false }))
    const paper = evaluateAll(intent, makeCtx({ isPaper: true }))
    expect(paper).toStrictEqual(live)
    expect(paper.approved).toBe(false)
  })

  it("gates a manual order on the caps, but not on the copy-specific gates", () => {
    // docs/03 §8: no subscription, no leader, no signal — exposure, leverage
    // and daily loss still apply.
    const manual = makeIntent({ subscriptionId: null, leaderRef: null })
    expect(
      evaluateAll(manual, makeCtx({ marketFilter: { type: "blocklist", markets: [BTC] } })).approved,
    ).toBe(true)

    const overLeveraged = evaluateAll(manual, makeCtx({ currentExposure: usd("45000.00") }))
    expect(overLeveraged.approved).toBe(false)
    if (!overLeveraged.approved) expect(overLeveraged.skip.reason).toBe("exposure_cap")
    if (!overLeveraged.approved) expect(overLeveraged.skip.subscriptionId).toBeNull()
  })

  it("keeps every detail value a string a ledger can store verbatim", () => {
    const result = evaluateAll(makeIntent({ size: size("50") }), makeCtx())
    expect(result.approved).toBe(false)
    if (result.approved) return
    for (const [key, value] of Object.entries(result.skip.detail)) {
      expect(typeof value, `${key} must be a string`).toBe("string")
      expect(value.length, `${key} must not be empty`).toBeGreaterThan(0)
    }
    // And the numbers round-trip: they are values, not display approximations.
    expect(money.format(money.parse(result.skip.detail.depthInBand ?? ""))).toBe("200.0000")
  })
})
