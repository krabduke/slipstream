/**
 * Gate 4 — slippage. The honest answer to docs/03 §1.1.
 *
 * The reference is **the leader's own fill price**, not the mid and not the
 * last trade. The question is "how much worse than what they got", because the
 * leader's own trade is part of why the price moved: measuring against the mid
 * would happily copy a whale's 0.38 buy at 0.61 and call it a 0 bps fill.
 *
 * We do not chase. If the price has already run past the leader's entry we
 * decline and say so, with the numbers. A well-configured Slipstream skips a
 * lot, and the skip is the product working (docs/03 §4).
 */
import { money } from "@slipstream/shared"
import type { TradeIntent } from "@slipstream/shared"
import type { Gate, GateVerdict, RiskContext } from "../types.js"
import { OK, executablePrice, isPositive, reject } from "./shared.js"

export const slippageGate: Gate = {
  name: "slippage",
  evaluate(intent: TradeIntent, ctx: RiskContext): GateVerdict {
    const leader = intent.leaderRef
    // Manual orders have no leader fill to be worse than (docs/03 §8).
    if (leader === null) return OK

    const reference = leader.leaderFillPrice
    if (!isPositive(reference)) {
      // A zero or negative reference price is corrupt input, not a cheap
      // entry. `money.diffBps` would throw on it; passing the gate would open
      // a position on the strength of a number that means nothing. Fail
      // closed, and put the offending value in the ledger.
      return reject("slippage_exceeded", {
        problem: "leader_fill_price_not_positive",
        leaderFillPrice: money.format(reference),
        leaderAddress: leader.leaderAddress,
        limitBps: String(ctx.limits.maxSlippageBps),
      })
    }

    const lookup = executablePrice(ctx, intent)
    if (!lookup.ok) return lookup.verdict
    const executable = lookup.price

    // `diffBps` is signed against the reference. Worse means *higher* when we
    // are buying and *lower* when we are selling, so one of the two flips.
    const signedBps = money.diffBps(reference, executable)
    const observedBps = intent.side === "buy" ? signedBps : -signedBps
    // A better-than-the-leader price is negative here and always passes.
    if (observedBps > ctx.limits.maxSlippageBps) {
      return reject("slippage_exceeded", {
        observedBps: String(observedBps),
        limitBps: String(ctx.limits.maxSlippageBps),
        [intent.side === "buy" ? "bestAsk" : "bestBid"]: money.format(executable),
        leaderFillPrice: money.format(reference),
        side: intent.side,
        leaderAddress: leader.leaderAddress,
      })
    }
    return OK
  },
}
