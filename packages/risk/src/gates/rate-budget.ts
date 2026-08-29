/**
 * Gate 10 — rate_budget.
 *
 * The reserve is not politeness towards the venue. Exits, kill-switch flattens
 * and reconciliation all need actions from the same per-address budget, and
 * they are the actions you least want to discover you cannot afford. Spending
 * the last 20% on opening a new position is how a follower ends up unable to
 * close one.
 *
 * The budget is a count of actions, not money — but it is compared against a
 * `Decimal` fraction, so the comparison is done in decimal rather than by
 * multiplying two floats and hoping.
 */
import { money } from "@slipstream/shared"
import type { TradeIntent } from "@slipstream/shared"
import type { Gate, GateVerdict, RiskContext } from "../types.js"
import { OK, reject } from "./shared.js"

const RESERVE_SCALE = 4

export const rateBudgetGate: Gate = {
  name: "rate_budget",
  evaluate(_intent: TradeIntent, ctx: RiskContext): GateVerdict {
    const { rateBudgetRemaining: remaining, rateBudgetInitial: initial } = ctx

    // An unreadable budget is not an unlimited one. Without a usable initial
    // there is no reserve to compute, and passing would mean opening a
    // position while unable to say whether we could still close it.
    if (
      !Number.isSafeInteger(remaining) ||
      !Number.isSafeInteger(initial) ||
      initial <= 0 ||
      remaining < 0
    ) {
      return reject("rate_budget_low", {
        problem: "rate_budget_unreadable",
        remaining: String(remaining),
        initial: String(initial),
        reserveFraction: money.format(ctx.limits.rateBudgetReserve),
      })
    }

    // Rounded up: a reserve of 19.2 actions means holding 20, not 19.
    const reserve = money.mul(
      money.fromInt(initial),
      ctx.limits.rateBudgetReserve,
      RESERVE_SCALE,
      "ceil",
    )
    if (money.lt(money.fromInt(remaining), reserve)) {
      return reject("rate_budget_low", {
        remaining: String(remaining),
        initial: String(initial),
        reserveActions: money.format(reserve),
        reserveFraction: money.format(ctx.limits.rateBudgetReserve),
      })
    }
    return OK
  },
}
