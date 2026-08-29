/**
 * Gate 9 — daily_loss. Once today's realised loss passes the limit we stop
 * opening for the day. Reducing and exiting are unaffected: an `ExitIntent`
 * never reaches a gate, so a bad day can never become a locked-in one.
 *
 * The limit is a fraction of *current* equity, which is already smaller than
 * the equity the day started with. That makes the stop slightly earlier than a
 * start-of-day basis would, which is the conservative direction, and it is the
 * only equity the context carries.
 */
import { money } from "@slipstream/shared"
import type { TradeIntent } from "@slipstream/shared"
import type { Gate, GateVerdict, RiskContext } from "../types.js"
import { OK, reject, requireEquity } from "./shared.js"

export const dailyLossGate: Gate = {
  name: "daily_loss",
  evaluate(_intent: TradeIntent, ctx: RiskContext): GateVerdict {
    // A profitable or flat day has nothing to check, and asking for equity
    // first would reject it for a reason that had no bearing on the decision.
    if (!money.isNegative(ctx.realizedPnlToday)) return OK

    const equity = requireEquity(ctx)
    if (!equity.ok) return equity.verdict

    const loss = money.abs(ctx.realizedPnlToday)
    const limit = money.mul(
      equity.equity,
      ctx.limits.dailyLossLimit,
      equity.equity.scale + ctx.limits.dailyLossLimit.scale,
      "trunc",
    )
    if (money.gt(loss, limit)) {
      return reject("daily_loss_limit", {
        realizedPnlToday: money.format(ctx.realizedPnlToday),
        lossToday: money.format(loss),
        lossLimit: money.format(limit),
        equity: money.format(equity.equity),
        dailyLossLimit: money.format(ctx.limits.dailyLossLimit),
        asOf: String(ctx.now),
      })
    }
    return OK
  },
}
