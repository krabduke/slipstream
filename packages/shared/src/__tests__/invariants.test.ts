/**
 * Wave 0 invariant tests.
 *
 * These do not test behaviour — there is none yet. They test that the CONTRACTS
 * hold, so that a later worker cannot quietly weaken them. Both assertions
 * below correspond to a claim made in the docs; if either stops compiling or
 * passing, the claim has become false.
 */
import { describe, expect, it } from "vitest"
import { notImplemented } from "../notimpl.js"
import type { ExitIntent, TradeIntent } from "../contracts/intents.js"
import type { Gate, RiskContext } from "@slipstream/risk"
import type { DelegationProof } from "@slipstream/venues"

describe("Wave 0 contracts", () => {
  it("stubs throw rather than silently returning undefined", () => {
    expect(() => notImplemented("W0", "example")).toThrowError(/Not implemented \(W0\)/)
  })

  it("exits are structurally ungateable (docs/03 §5)", () => {
    // A gate accepts TradeIntent. Passing an ExitIntent must not compile.
    // If this @ts-expect-error ever becomes 'unused', someone has widened the
    // gate signature and exits can now be blocked — which traps a follower in
    // a position their leader has already left.
    const gate = null as unknown as Gate
    const ctx = null as unknown as RiskContext
    const exit = null as unknown as ExitIntent
    const trade = null as unknown as TradeIntent

    // @ts-expect-error ExitIntent must not be assignable to Gate.evaluate
    const _bad = () => gate.evaluate(exit, ctx)
    const _good = () => gate.evaluate(trade, ctx)

    expect(typeof _bad).toBe("function")
    expect(typeof _good).toBe("function")
  })

  it("a delegation proof cannot assert withdrawal capability (docs/04 §1)", () => {
    // canWithdraw is the literal type `false`. Constructing a proof claiming
    // otherwise is a compile error, so the security invariant cannot be
    // weakened by a later edit without someone deliberately changing the type.
    const bad: DelegationProof = {
      venue: "hyperliquid",
      owner: "0xowner" as never,
      signer: "0xsigner" as never,
      // @ts-expect-error canWithdraw is the literal `false`, never `true`
      canWithdraw: true,
      verifiedAt: 0 as never,
      method: "test",
    }

    const good: DelegationProof = {
      venue: "hyperliquid",
      owner: "0xowner" as never,
      signer: "0xsigner" as never,
      canWithdraw: false,
      verifiedAt: 0 as never,
      method: "test",
    }

    expect(bad.venue).toBe("hyperliquid")
    expect(good.canWithdraw).toBe(false)
  })
})
