/**
 * One test per gate that actually fires it, asserting the exact `ReasonCode`
 * and that the `detail` map carries the real numbers.
 *
 * The detail strings are rendered straight into the activity feed, which is the
 * product's trust surface (docs/03 §7), so they are asserted literally. A test
 * that recomputed the expected value with the same code the gate uses would
 * agree with any bug the gate has.
 */
import { describe, expect, it } from "vitest"
import { asTimestamp, money } from "@slipstream/shared"
import { bookDepthGate } from "../gates/book-depth.js"
import { dailyLossGate } from "../gates/daily-loss.js"
import { exposureCapGate } from "../gates/exposure-cap.js"
import { killSwitchGate } from "../gates/kill-switch.js"
import { leverageCapGate } from "../gates/leverage-cap.js"
import { marketFilterGate } from "../gates/market-filter.js"
import { positionCapGate } from "../gates/position-cap.js"
import { rateBudgetGate } from "../gates/rate-budget.js"
import { signalAgeGate } from "../gates/signal-age.js"
import { slippageGate } from "../gates/slippage.js"
import {
  BTC,
  ETH,
  LEADER,
  NOW,
  d,
  expectPass,
  level,
  makeBook,
  makeConstraints,
  makeCtx,
  makeIntent,
  makeLeaderRef,
  makeLimits,
  makePosition,
  price,
  rejection,
  size,
  usd,
} from "./fixtures.js"

describe("kill_switch", () => {
  it("rejects with the broadest scope that is set", () => {
    const { reason, detail } = rejection(
      killSwitchGate.evaluate(
        makeIntent(),
        makeCtx({ kill: { global: true, user: true, subscription: true } }),
      ),
    )
    expect(reason).toBe("kill_switch_global")
    // Every scope is reported, so the ledger row says what else was also set.
    expect(detail).toEqual({ scope: "global", global: "true", user: "true", subscription: "true" })
  })

  it("reports the user switch when only the user switch is set", () => {
    const { reason, detail } = rejection(
      killSwitchGate.evaluate(
        makeIntent(),
        makeCtx({ kill: { global: false, user: true, subscription: false } }),
      ),
    )
    expect(reason).toBe("kill_switch_user")
    expect(detail.user).toBe("true")
    expect(detail.global).toBe("false")
  })

  it("reports the subscription switch when only that is set", () => {
    const { reason } = rejection(
      killSwitchGate.evaluate(
        makeIntent(),
        makeCtx({ kill: { global: false, user: false, subscription: true } }),
      ),
    )
    expect(reason).toBe("kill_switch_subscription")
  })

  it("passes when nothing is stopped", () => {
    expectPass(killSwitchGate.evaluate(makeIntent(), makeCtx()))
  })
})

describe("market_filter", () => {
  it("rejects a market missing from the allowlist", () => {
    const { reason, detail } = rejection(
      marketFilterGate.evaluate(
        makeIntent(),
        makeCtx({ marketFilter: { type: "allowlist", markets: [ETH] } }),
      ),
    )
    expect(reason).toBe("market_filtered")
    expect(detail).toEqual({
      filter: "allowlist",
      marketId: "BTC",
      venue: "hyperliquid",
      listSize: "1",
    })
  })

  it("rejects a market present on the blocklist", () => {
    const { reason, detail } = rejection(
      marketFilterGate.evaluate(
        makeIntent(),
        makeCtx({ marketFilter: { type: "blocklist", markets: [BTC, ETH] } }),
      ),
    )
    expect(reason).toBe("market_filtered")
    expect(detail.filter).toBe("blocklist")
    expect(detail.listSize).toBe("2")
  })

  it("does not filter a manual order — it has no subscription (docs/03 §8)", () => {
    expectPass(
      marketFilterGate.evaluate(
        makeIntent({ subscriptionId: null, leaderRef: null }),
        makeCtx({ marketFilter: { type: "blocklist", markets: [BTC] } }),
      ),
    )
  })
})

describe("signal_age", () => {
  it("rejects a signal older than the limit", () => {
    const { reason, detail } = rejection(
      signalAgeGate.evaluate(
        makeIntent({ leaderRef: makeLeaderRef({ leaderFillTs: asTimestamp(NOW - 8000) }) }),
        makeCtx(),
      ),
    )
    expect(reason).toBe("signal_stale")
    expect(detail).toEqual({
      ageMs: "8000",
      limitMs: "5000",
      leaderFillTs: String(NOW - 8000),
      now: String(NOW),
      leaderAddress: LEADER,
    })
  })

  it("passes at exactly the limit, and measures against ctx.now", () => {
    expectPass(
      signalAgeGate.evaluate(
        makeIntent({ leaderRef: makeLeaderRef({ leaderFillTs: asTimestamp(NOW - 5000) }) }),
        makeCtx(),
      ),
    )
  })

  it("has nothing to age for a manual order", () => {
    expectPass(signalAgeGate.evaluate(makeIntent({ leaderRef: null }), makeCtx()))
  })
})

describe("slippage", () => {
  it("rejects a buy that has run past the leader's fill (docs/03 §7)", () => {
    // The ledger example: leader long BTC @ 64,210, best ask already 64,769.
    const { reason, detail } = rejection(
      slippageGate.evaluate(
        makeIntent({ leaderRef: makeLeaderRef({ leaderFillPrice: price("64210.0") }) }),
        makeCtx({ book: makeBook({ asks: [level("64769.0", "100")] }) }),
      ),
    )
    expect(reason).toBe("slippage_exceeded")
    expect(detail).toEqual({
      observedBps: "87",
      limitBps: "50",
      bestAsk: "64769.0",
      leaderFillPrice: "64210.0",
      side: "buy",
      leaderAddress: LEADER,
    })
  })

  it("measures a sell in the other direction — worse means lower", () => {
    const { reason, detail } = rejection(
      slippageGate.evaluate(
        makeIntent({ side: "sell", leaderRef: makeLeaderRef({ leaderFillPrice: price("64210.0") }) }),
        makeCtx({ book: makeBook({ bids: [level("63000.0", "100")] }) }),
      ),
    )
    expect(reason).toBe("slippage_exceeded")
    expect(detail.observedBps).toBe("188")
    expect(detail.bestBid).toBe("63000.0")
    expect(detail.bestAsk).toBeUndefined()
  })

  it("passes a price better than the leader's — favourable slippage is negative", () => {
    expectPass(
      slippageGate.evaluate(
        makeIntent({ leaderRef: makeLeaderRef({ leaderFillPrice: price("64210.0") }) }),
        makeCtx({ book: makeBook({ asks: [level("64000.0", "100")] }) }),
      ),
    )
  })

  it("compares against the leader's fill, not the mid or the best bid", () => {
    // A 0.38 leader fill with the ask at 0.61 is the canonical failure in
    // docs/03 §1.1. The mid would call this a fair price; the leader's own
    // fill calls it 6052 bps.
    const { detail } = rejection(
      slippageGate.evaluate(
        makeIntent({ leaderRef: makeLeaderRef({ leaderFillPrice: d("0.38", 2) }) }),
        makeCtx({
          book: makeBook({
            asks: [{ price: d("0.61", 2), size: size("100000") }],
            bids: [{ price: d("0.60", 2), size: size("100000") }],
          }),
        }),
      ),
    )
    expect(detail.observedBps).toBe("6052")
    expect(detail.bestAsk).toBe("0.61")
  })

  it("fails closed on a non-positive leader fill price rather than throwing", () => {
    const { reason, detail } = rejection(
      slippageGate.evaluate(
        makeIntent({ leaderRef: makeLeaderRef({ leaderFillPrice: price("0.0") }) }),
        makeCtx(),
      ),
    )
    expect(reason).toBe("slippage_exceeded")
    expect(detail.problem).toBe("leader_fill_price_not_positive")
    expect(detail.leaderFillPrice).toBe("0.0")
  })

  it("has no leader to compare a manual order against", () => {
    expectPass(slippageGate.evaluate(makeIntent({ leaderRef: null }), makeCtx()))
  })
})

describe("book_depth", () => {
  it("counts only the depth inside the slippage band", () => {
    // 1 lot reachable at 64,210 and 1000 lots parked at 64,900, well outside a
    // 50 bps band on a 64,200 fill. Total depth would pass this order; usable
    // depth is 1 lot, and 0.5 is half of it.
    const { reason, detail } = rejection(
      bookDepthGate.evaluate(
        makeIntent({ size: size("0.5") }),
        makeCtx({
          book: makeBook({ asks: [level("64210.0", "1"), level("64900.0", "1000")] }),
        }),
      ),
    )
    expect(reason).toBe("book_too_thin")
    expect(detail).toEqual({
      orderSize: "0.5000",
      depthInBand: "1.0000",
      allowedSize: "0.20000000",
      maxBookPct: "0.2000",
      levelsInBand: "1",
      bandEdge: "64521.00000",
      bestPrice: "64210.0",
      orderNotional: "32105.00000",
      side: "buy",
    })
  })

  it("rejects an order consuming more than 20% of in-band depth", () => {
    const { reason, detail } = rejection(
      bookDepthGate.evaluate(makeIntent({ size: size("50") }), makeCtx()),
    )
    expect(reason).toBe("book_too_thin")
    expect(detail.depthInBand).toBe("200.0000")
    expect(detail.allowedSize).toBe("40.00000000")
    expect(detail.levelsInBand).toBe("2")
  })

  it("passes at exactly the allowed share", () => {
    expectPass(bookDepthGate.evaluate(makeIntent({ size: size("40") }), makeCtx()))
  })

  it("tightens the band to our own limit price when that binds first", () => {
    const { detail } = rejection(
      bookDepthGate.evaluate(
        makeIntent({ size: size("30"), limitPrice: price("64220.0") }),
        makeCtx(),
      ),
    )
    expect(detail.bandEdge).toBe("64220.0")
    expect(detail.depthInBand).toBe("100.0000")
    expect(detail.levelsInBand).toBe("1")
  })

  it("finds the best price by scanning, not by trusting the book to be sorted", () => {
    const { detail } = rejection(
      bookDepthGate.evaluate(
        makeIntent({ size: size("50") }),
        makeCtx({ book: makeBook({ asks: [level("64900.0", "100"), level("64210.0", "100")] }) }),
      ),
    )
    expect(detail.bestPrice).toBe("64210.0")
    expect(detail.levelsInBand).toBe("1")
  })

  it("fails closed when the crossed side is empty", () => {
    const { reason, detail } = rejection(
      bookDepthGate.evaluate(makeIntent(), makeCtx({ book: makeBook({ asks: [] }) })),
    )
    expect(reason).toBe("book_too_thin")
    expect(detail.problem).toBe("no_usable_level_on_crossed_side")
    expect(detail.crossedSide).toBe("asks")
    expect(detail.rawLevels).toBe("0")
  })

  it("does not count a zero-size level as liquidity", () => {
    const { detail } = rejection(
      bookDepthGate.evaluate(
        makeIntent(),
        makeCtx({ book: makeBook({ asks: [level("64210.0", "0")] }) }),
      ),
    )
    expect(detail.problem).toBe("no_usable_level_on_crossed_side")
    expect(detail.usableLevels).toBe("0")
    expect(detail.rawLevels).toBe("1")
  })

  it("does not throw on a limit that is not a whole number of basis points", () => {
    // `money.bpsOf` refuses a fractional bps rather than making a float; a gate
    // that let that escape would take the planner tick down with it.
    const verdict = bookDepthGate.evaluate(
      makeIntent({ size: size("50") }),
      makeCtx({ limits: makeLimits({ maxSlippageBps: 50.5 }) }),
    )
    const { reason, detail } = rejection(verdict)
    expect(reason).toBe("book_too_thin")
    expect(detail.bandEdge).toBe("64521.00000")
  })

  it("fails closed rather than judging an order against another market's book", () => {
    const { reason, detail } = rejection(
      bookDepthGate.evaluate(makeIntent(), makeCtx({ book: makeBook({ marketId: ETH }) })),
    )
    expect(reason).toBe("book_too_thin")
    expect(detail.problem).toBe("book_market_mismatch")
    expect(detail.intentMarketId).toBe("BTC")
    expect(detail.bookMarketId).toBe("ETH")
  })
})

describe("position_cap", () => {
  it("rejects a resulting notional over the absolute cap", () => {
    const { reason, detail } = rejection(
      positionCapGate.evaluate(makeIntent({ size: size("0.02") }), makeCtx()),
    )
    expect(reason).toBe("position_cap")
    expect(detail).toEqual({
      marketId: "BTC",
      venue: "hyperliquid",
      markPrice: "64210.0",
      existingSize: "0.0000",
      orderSize: "0.0200",
      resultingSize: "0.0200",
      resultingNotional: "1284.20000",
      limitNotional: "1000.00",
    })
  })

  it("rejects a resulting notional over the share-of-equity cap", () => {
    const { reason, detail } = rejection(
      positionCapGate.evaluate(makeIntent(), makeCtx({ followerEquity: usd("1000.00") })),
    )
    expect(reason).toBe("position_pct_equity_cap")
    expect(detail.resultingNotional).toBe("642.10000")
    expect(detail.limitNotional).toBe("200.000000")
    expect(detail.equity).toBe("1000.00")
    expect(detail.maxPositionPctEquity).toBe("0.2000")
  })

  it("adds to an existing position in the same market", () => {
    const { detail } = rejection(
      positionCapGate.evaluate(
        makeIntent({ size: size("0.01") }),
        makeCtx({ followerPositions: [makePosition({ size: size("0.05") })] }),
      ),
    )
    expect(detail.existingSize).toBe("0.0500")
    expect(detail.resultingSize).toBe("0.0600")
    expect(detail.resultingNotional).toBe("3852.60000")
  })

  it("nets an opposite-side order down instead of counting it as new risk", () => {
    // Manual orders can be on either side (docs/03 §8). A cap that added a
    // sell to a long would block a user from reducing their own position.
    const { detail } = rejection(
      positionCapGate.evaluate(
        makeIntent({ side: "sell", size: size("0.02"), leaderRef: null }),
        makeCtx({ followerPositions: [makePosition({ size: size("0.05") })] }),
      ),
    )
    expect(detail.existingSize).toBe("0.0500")
    expect(detail.resultingSize).toBe("0.0300")
    expect(detail.markPrice).toBe("64190.0")
  })

  it("fails closed when the follower's equity is unknown", () => {
    const { reason, detail } = rejection(
      positionCapGate.evaluate(makeIntent(), makeCtx({ followerEquity: null })),
    )
    expect(reason).toBe("follower_equity_unavailable")
    expect(detail).toEqual({ problem: "follower_equity_null", asOf: String(NOW) })
  })

  it("passes an order inside both caps", () => {
    expectPass(positionCapGate.evaluate(makeIntent(), makeCtx()))
  })
})

describe("exposure_cap", () => {
  it("rejects when the resulting total exposure exceeds the cap", () => {
    const { reason, detail } = rejection(
      exposureCapGate.evaluate(makeIntent(), makeCtx({ currentExposure: usd("4500.00") })),
    )
    expect(reason).toBe("exposure_cap")
    expect(detail).toEqual({
      currentExposure: "4500.00",
      exposureDelta: "642.10000",
      resultingExposure: "5142.10000",
      limitExposure: "5000.000000",
      equity: "10000.00",
      maxTotalExposure: "0.5000",
      markPrice: "64210.0",
    })
  })

  it("counts an order that nets a position down as negative exposure", () => {
    const verdict = exposureCapGate.evaluate(
      makeIntent({ side: "sell", size: size("0.02"), leaderRef: null }),
      makeCtx({
        currentExposure: usd("4990.00"),
        followerPositions: [makePosition({ size: size("0.05") })],
      }),
    )
    expectPass(verdict)
  })

  it("fails closed when the follower's equity is unknown", () => {
    const { reason } = rejection(
      exposureCapGate.evaluate(makeIntent(), makeCtx({ followerEquity: null })),
    )
    expect(reason).toBe("follower_equity_unavailable")
  })
})

describe("leverage_cap", () => {
  it("rejects when resulting leverage exceeds the user's cap", () => {
    const { reason, detail } = rejection(
      leverageCapGate.evaluate(makeIntent(), makeCtx({ currentExposure: usd("45000.00") })),
    )
    expect(reason).toBe("leverage_cap")
    expect(detail).toEqual({
      resultingLeverage: "4.564210",
      resultingExposure: "45642.10000",
      maxExposureAtLimit: "30000.0000",
      equity: "10000.00",
      limitLeverage: "3.00",
      userMaxLeverage: "3.00",
      venueMaxLeverage: "50.00",
    })
  })

  it("uses the venue's own maximum when it is tighter than the user's", () => {
    // Polymarket is 1x. Reading it from the constraints is why nothing above
    // the venue seam hardcodes a venue's leverage.
    const { reason, detail } = rejection(
      leverageCapGate.evaluate(
        makeIntent(),
        makeCtx({
          currentExposure: usd("9500.00"),
          constraints: makeConstraints({ maxLeverage: d("1", 2) }),
        }),
      ),
    )
    expect(reason).toBe("leverage_cap")
    expect(detail.limitLeverage).toBe("1.00")
    expect(detail.venueMaxLeverage).toBe("1.00")
    expect(detail.userMaxLeverage).toBe("3.00")
  })

  it("shows no leverage ratio when equity is negative", () => {
    const { reason, detail } = rejection(
      leverageCapGate.evaluate(makeIntent(), makeCtx({ followerEquity: usd("-10.00") })),
    )
    expect(reason).toBe("leverage_cap")
    expect(detail.equity).toBe("-10.00")
    expect(detail.resultingLeverage).toBeUndefined()
  })

  it("rejects without dividing by a zero equity", () => {
    const { reason, detail } = rejection(
      leverageCapGate.evaluate(makeIntent(), makeCtx({ followerEquity: usd("0.00") })),
    )
    expect(reason).toBe("leverage_cap")
    expect(detail.equity).toBe("0.00")
    expect(detail.resultingLeverage).toBeUndefined()
  })
})

describe("daily_loss", () => {
  it("stops opening once today's realised loss passes the limit", () => {
    const { reason, detail } = rejection(
      dailyLossGate.evaluate(makeIntent(), makeCtx({ realizedPnlToday: usd("-1500.00") })),
    )
    expect(reason).toBe("daily_loss_limit")
    expect(detail).toEqual({
      realizedPnlToday: "-1500.00",
      lossToday: "1500.00",
      lossLimit: "1000.000000",
      equity: "10000.00",
      dailyLossLimit: "0.1000",
      asOf: String(NOW),
    })
  })

  it("passes a loss inside the limit", () => {
    expectPass(dailyLossGate.evaluate(makeIntent(), makeCtx({ realizedPnlToday: usd("-500.00") })))
  })

  it("does not need equity to know a profitable day is fine", () => {
    expectPass(
      dailyLossGate.evaluate(
        makeIntent(),
        makeCtx({ realizedPnlToday: usd("120.00"), followerEquity: null }),
      ),
    )
  })

  it("fails closed on a losing day with unknown equity", () => {
    const { reason } = rejection(
      dailyLossGate.evaluate(
        makeIntent(),
        makeCtx({ realizedPnlToday: usd("-1.00"), followerEquity: null }),
      ),
    )
    expect(reason).toBe("follower_equity_unavailable")
  })
})

describe("rate_budget", () => {
  it("rejects once the remaining budget is inside the reserve", () => {
    const { reason, detail } = rejection(
      rateBudgetGate.evaluate(
        makeIntent(),
        makeCtx({ rateBudgetRemaining: 15, rateBudgetInitial: 100 }),
      ),
    )
    expect(reason).toBe("rate_budget_low")
    expect(detail).toEqual({
      remaining: "15",
      initial: "100",
      reserveActions: "20.0000",
      reserveFraction: "0.2000",
    })
  })

  it("passes at exactly the reserve", () => {
    expectPass(
      rateBudgetGate.evaluate(
        makeIntent(),
        makeCtx({ rateBudgetRemaining: 20, rateBudgetInitial: 100 }),
      ),
    )
  })

  it("rounds the reserve up — 19.2 actions held means 20", () => {
    const { detail } = rejection(
      rateBudgetGate.evaluate(
        makeIntent(),
        makeCtx({ rateBudgetRemaining: 19, rateBudgetInitial: 97 }),
      ),
    )
    expect(detail.reserveActions).toBe("19.4000")
  })

  it("treats an unreadable budget as low, not as unlimited", () => {
    const { reason, detail } = rejection(
      rateBudgetGate.evaluate(
        makeIntent(),
        makeCtx({ rateBudgetRemaining: 500, rateBudgetInitial: 0 }),
      ),
    )
    expect(reason).toBe("rate_budget_low")
    expect(detail.problem).toBe("rate_budget_unreadable")
    expect(detail.initial).toBe("0")
  })
})

describe("limits are read from the context, never hardcoded", () => {
  it("honours a widened slippage limit", () => {
    expectPass(
      slippageGate.evaluate(
        makeIntent({ leaderRef: makeLeaderRef({ leaderFillPrice: price("64210.0") }) }),
        makeCtx({
          limits: makeLimits({ maxSlippageBps: 300 }),
          book: makeBook({ asks: [level("64769.0", "100")] }),
        }),
      ),
    )
  })

  it("never converts a money value through a float", () => {
    // 0.1 + 0.2 in a size calculation is a rejected order at best.
    const verdict = positionCapGate.evaluate(
      makeIntent({ size: size("0.1") }),
      makeCtx({
        book: makeBook({ asks: [level("0.2", "1000")] }),
        limits: makeLimits({ maxNotionalPerPosition: d("0.01", 5) }),
      }),
    )
    const { detail } = rejection(verdict)
    expect(detail.resultingNotional).toBe("0.02000")
    expect(money.parse(detail.resultingNotional ?? "").mantissa).toBe(2000n)
  })
})
