/**
 * Gate 2 — market_filter.
 *
 * The allow/blocklist belongs to a subscription. A manual order has no
 * subscription (`subscriptionId === null`) and by docs/03 §8 skips the
 * copy-specific gates — `market_filter`, `signal_age` and `slippage`-vs-leader
 * — while still paying the exposure, leverage and daily-loss caps. The bypass
 * lives here rather than in the caller so that a caller cannot forget it, and
 * so that it is one line to read rather than a convention to remember.
 */
import type { Gate, GateVerdict, RiskContext } from "../types.js"
import type { TradeIntent } from "@slipstream/shared"
import { OK, reject } from "./shared.js"

export const marketFilterGate: Gate = {
  name: "market_filter",
  evaluate(intent: TradeIntent, ctx: RiskContext): GateVerdict {
    if (intent.subscriptionId === null) return OK

    const filter = ctx.marketFilter
    switch (filter.type) {
      case "allow_all":
        return OK
      case "allowlist":
        return filter.markets.includes(intent.marketId)
          ? OK
          : reject("market_filtered", {
              filter: "allowlist",
              marketId: intent.marketId,
              venue: intent.venue,
              listSize: String(filter.markets.length),
            })
      case "blocklist":
        return filter.markets.includes(intent.marketId)
          ? reject("market_filtered", {
              filter: "blocklist",
              marketId: intent.marketId,
              venue: intent.venue,
              listSize: String(filter.markets.length),
            })
          : OK
    }
  },
}
