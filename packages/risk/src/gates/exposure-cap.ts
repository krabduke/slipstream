/**
 * Gate 7 — exposure_cap. Total exposure across every position, not just this
 * one: ten positions at 19% of equity each are not ten safe trades.
 *
 * The resulting figure is `currentExposure` plus the *change* this order makes
 * to its own market, so an order that nets an existing position down reduces
 * exposure rather than adding to it.
 */
import { money } from "@slipstream/shared"
import type { TradeIntent } from "@slipstream/shared"
import type { Gate, GateVerdict, RiskContext } from "../types.js"
import {
  OK,
  executablePrice,
  marketDelta,
  reject,
  requireEquity,
  resultingExposure,
} from "./shared.js"

export const exposureCapGate: Gate = {
  name: "exposure_cap",
  evaluate(intent: TradeIntent, ctx: RiskContext): GateVerdict {
    const lookup = executablePrice(ctx, intent)
    if (!lookup.ok) return lookup.verdict
    const equity = requireEquity(ctx)
    if (!equity.ok) return equity.verdict

    const delta = marketDelta(ctx, intent, lookup.price)
    const resulting = resultingExposure(ctx, delta)
    const limit = money.mul(
      equity.equity,
      ctx.limits.maxTotalExposure,
      equity.equity.scale + ctx.limits.maxTotalExposure.scale,
      "trunc",
    )

    if (money.gt(resulting, limit)) {
      return reject("exposure_cap", {
        currentExposure: money.format(ctx.currentExposure),
        exposureDelta: money.format(delta.exposureDelta),
        resultingExposure: money.format(resulting),
        limitExposure: money.format(limit),
        equity: money.format(equity.equity),
        maxTotalExposure: money.format(ctx.limits.maxTotalExposure),
        markPrice: money.format(lookup.price),
      })
    }
    return OK
  },
}
