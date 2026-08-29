/** W14 — the gates, in evaluation order. Contract: ./types.ts
 *  Note: `evaluate` accepts TradeIntent only. Exits are never gated. */
import type { SkipDecision, TradeIntent } from "@slipstream/shared"
import type { Gate, GateResult, RiskContext } from "./types.js"
import { killSwitchGate } from "./gates/kill-switch.js"
import { marketFilterGate } from "./gates/market-filter.js"
import { signalAgeGate } from "./gates/signal-age.js"
import { slippageGate } from "./gates/slippage.js"
import { bookDepthGate } from "./gates/book-depth.js"
import { positionCapGate } from "./gates/position-cap.js"
import { exposureCapGate } from "./gates/exposure-cap.js"
import { leverageCapGate } from "./gates/leverage-cap.js"
import { dailyLossGate } from "./gates/daily-loss.js"
import { rateBudgetGate } from "./gates/rate-budget.js"

/**
 * Order is part of the contract (docs/03 §4), not an implementation detail.
 *
 * Cheap and categorical first, market-dependent second, account-dependent last:
 * a user whose kill switch is on should never see "your book was too thin" as
 * the reason nothing happened, and a market that is filtered out should not
 * cost a book scan to decline. The first failure short-circuits, so the reason
 * that reaches the ledger is the *first* true reason, which is the one worth
 * showing.
 *
 * `ctx.isPaper` is deliberately absent from every gate. Paper mode runs the
 * identical planner, gates and ledger and swaps only the executor (docs/03 §9);
 * a gate that skipped in paper would make paper mode a worse predictor of live
 * behaviour, which is the one thing a simulation must not be.
 */
export const GATES: readonly Gate[] = Object.freeze([
  killSwitchGate,
  marketFilterGate,
  signalAgeGate,
  slippageGate,
  bookDepthGate,
  positionCapGate,
  exposureCapGate,
  leverageCapGate,
  dailyLossGate,
  rateBudgetGate,
])

/**
 * Run every gate against a `TradeIntent` and either approve it unchanged or
 * produce the `SkipDecision` that goes in the ledger.
 *
 * There is no `ExitIntent` path here, and adding one would contradict
 * docs/03 §5: exits are unconditional, and a gate that can block one traps a
 * follower in a leveraged position their leader has already abandoned.
 *
 * Pure. `createdAt` comes from `ctx.now` rather than a clock, so the same
 * inputs always produce the same skip row.
 */
export const evaluateAll = (intent: TradeIntent, ctx: RiskContext): GateResult => {
  for (const gate of GATES) {
    const verdict = gate.evaluate(intent, ctx)
    if (!verdict.ok) {
      const skip: SkipDecision = {
        kind: "skip",
        userId: intent.userId,
        subscriptionId: intent.subscriptionId,
        venue: intent.venue,
        marketId: intent.marketId,
        reason: verdict.reason,
        // The gate name rides along so a ledger row can name what declined it
        // without the UI having to keep its own reason-to-gate mapping.
        detail: Object.freeze({ gate: gate.name, ...verdict.detail }),
        leaderRef: intent.leaderRef,
        createdAt: ctx.now,
      }
      return { approved: false, skip }
    }
  }
  return { approved: true, intent }
}

export type { SkipDecision }
