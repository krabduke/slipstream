/**
 * Gate 6 — position_cap.
 *
 * Two limits on the same number: an absolute ceiling in dollars, and a share of
 * the account. Both are on the *resulting* position, marked at the price this
 * order would transact at — the same price gates 4, 5, 7 and 8 use, so no two
 * gates can disagree about what the order is worth.
 *
 * The absolute cap is checked first because it is the one that can be answered
 * without knowing the follower's equity, and a concrete "$1,400 exceeds your
 * $1,000 cap" is a better ledger line than "we could not read your equity".
 */
import { money } from "@slipstream/shared"
import type { TradeIntent } from "@slipstream/shared"
import type { Gate, GateVerdict, RiskContext } from "../types.js"
import { OK, executablePrice, marketDelta, reject, requireEquity } from "./shared.js"

export const positionCapGate: Gate = {
  name: "position_cap",
  evaluate(intent: TradeIntent, ctx: RiskContext): GateVerdict {
    const lookup = executablePrice(ctx, intent)
    if (!lookup.ok) return lookup.verdict
    const price = lookup.price
    const delta = marketDelta(ctx, intent, price)

    const base = {
      marketId: intent.marketId,
      venue: intent.venue,
      markPrice: money.format(price),
      existingSize: money.format(delta.existingSize),
      orderSize: money.format(intent.size),
      resultingSize: money.format(delta.resultingSize),
      resultingNotional: money.format(delta.resultingNotional),
    }

    if (money.gt(delta.resultingNotional, ctx.limits.maxNotionalPerPosition)) {
      return reject("position_cap", {
        ...base,
        limitNotional: money.format(ctx.limits.maxNotionalPerPosition),
      })
    }

    const equity = requireEquity(ctx)
    if (!equity.ok) return equity.verdict

    // Exact: target scale is the product's own scale, so nothing rounds. Using
    // a multiplication rather than dividing the notional by equity also means
    // a zero or negative equity needs no special case — the limit is zero or
    // negative and any real position exceeds it.
    const limit = money.mul(
      equity.equity,
      ctx.limits.maxPositionPctEquity,
      equity.equity.scale + ctx.limits.maxPositionPctEquity.scale,
      "trunc",
    )
    if (money.gt(delta.resultingNotional, limit)) {
      return reject("position_pct_equity_cap", {
        ...base,
        limitNotional: money.format(limit),
        equity: money.format(equity.equity),
        maxPositionPctEquity: money.format(ctx.limits.maxPositionPctEquity),
      })
    }
    return OK
  },
}
