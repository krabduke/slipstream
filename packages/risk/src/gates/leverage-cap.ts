/**
 * Gate 8 — leverage_cap. Resulting account leverage, exposure over equity.
 *
 * The effective limit is the tighter of the user's cap and the venue's own
 * (`constraints.maxLeverage`, which is 1 on Polymarket). Reading it from the
 * constraints is the point of the venue seam: nothing above it hardcodes a
 * venue's leverage, and a user who sets 3x on a 1x market gets 1x rather than a
 * rejection from the exchange after the fact.
 */
import { money } from "@slipstream/shared"
import type { TradeIntent } from "@slipstream/shared"
import type { Gate, GateVerdict, RiskContext } from "../types.js"
import {
  OK,
  executablePrice,
  marketDelta,
  ratioOrNull,
  reject,
  requireEquity,
  resultingExposure,
} from "./shared.js"

export const leverageCapGate: Gate = {
  name: "leverage_cap",
  evaluate(intent: TradeIntent, ctx: RiskContext): GateVerdict {
    const lookup = executablePrice(ctx, intent)
    if (!lookup.ok) return lookup.verdict
    const equity = requireEquity(ctx)
    if (!equity.ok) return equity.verdict

    const delta = marketDelta(ctx, intent, lookup.price)
    const resulting = resultingExposure(ctx, delta)
    const effective = money.min(ctx.limits.maxLeverage, ctx.constraints.maxLeverage)
    const limit = money.mul(
      equity.equity,
      effective,
      equity.equity.scale + effective.scale,
      "trunc",
    )

    if (money.gt(resulting, limit)) {
      // Only informational, and only defined when equity is non-zero — the
      // comparison above never divides, so a zero-equity account rejects here
      // without anyone dividing by it.
      const leverage = ratioOrNull(resulting, equity.equity)
      return reject("leverage_cap", {
        ...(leverage === null ? {} : { resultingLeverage: leverage }),
        resultingExposure: money.format(resulting),
        maxExposureAtLimit: money.format(limit),
        equity: money.format(equity.equity),
        limitLeverage: money.format(effective),
        userMaxLeverage: money.format(ctx.limits.maxLeverage),
        venueMaxLeverage: money.format(ctx.constraints.maxLeverage),
      })
    }
    return OK
  },
}
