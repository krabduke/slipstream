/**
 * Gate 1 — kill_switch.
 *
 * A kill switch stops *opening*. It does not stop exiting: docs/03 §5 is
 * explicit that a kill switch is a thing that CAUSES exits, and an exit is an
 * `ExitIntent`, which cannot be passed to `evaluate` at all. That is the whole
 * mechanism — there is no `if (isExit)` here to get wrong.
 */
import type { Gate, GateVerdict, RiskContext } from "../types.js"
import type { TradeIntent } from "@slipstream/shared"
import { OK, reject } from "./shared.js"

/** Broadest scope first: if the operator has stopped the world, the user's own
 *  switch is not the interesting fact to report. */
export const killSwitchGate: Gate = {
  name: "kill_switch",
  evaluate(_intent: TradeIntent, ctx: RiskContext): GateVerdict {
    const flags = {
      global: String(ctx.kill.global),
      user: String(ctx.kill.user),
      subscription: String(ctx.kill.subscription),
    }
    if (ctx.kill.global) return reject("kill_switch_global", { scope: "global", ...flags })
    if (ctx.kill.user) return reject("kill_switch_user", { scope: "user", ...flags })
    if (ctx.kill.subscription) {
      return reject("kill_switch_subscription", { scope: "subscription", ...flags })
    }
    return OK
  },
}
