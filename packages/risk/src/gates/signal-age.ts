/**
 * Gate 3 — signal_age.
 *
 * How long ago the leader's fill happened, measured against `ctx.now` — never
 * `Date.now()`. A gate that reads the clock itself gives a different verdict
 * under load than it does in a test, which makes both the test and the
 * production behaviour meaningless.
 *
 * No leader reference means there is no signal to be stale: a manual order is
 * the user acting now (docs/03 §8).
 */
import type { Gate, GateVerdict, RiskContext } from "../types.js"
import type { TradeIntent } from "@slipstream/shared"
import { OK, reject } from "./shared.js"

export const signalAgeGate: Gate = {
  name: "signal_age",
  evaluate(intent: TradeIntent, ctx: RiskContext): GateVerdict {
    const leader = intent.leaderRef
    if (leader === null) return OK

    const ageMs = ctx.now - leader.leaderFillTs
    // A negative age is clock skew between us and the venue, not freshness we
    // earned; it is reported but not rejected, because "older than" is the
    // question this gate answers and a future timestamp is not older.
    if (ageMs > ctx.limits.maxSignalAgeMs) {
      return reject("signal_stale", {
        ageMs: String(ageMs),
        limitMs: String(ctx.limits.maxSignalAgeMs),
        leaderFillTs: String(leader.leaderFillTs),
        now: String(ctx.now),
        leaderAddress: leader.leaderAddress,
      })
    }
    return OK
  },
}
