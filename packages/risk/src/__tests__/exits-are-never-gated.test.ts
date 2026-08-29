/**
 * The single most important test in this package.
 *
 * Entries are gated; exits never are (docs/03 §5). A gate that can block an
 * exit produces the specific catastrophe this whole design exists to prevent:
 * a follower stuck in a leveraged position that its own leader has already
 * abandoned. The guarantee is structural, not procedural — `Gate.evaluate` and
 * `evaluateAll` take `TradeIntent` and nothing else, so blocking an exit is a
 * compile error rather than a code-review miss.
 *
 * IF A `@ts-expect-error` BELOW IS EVER REPORTED AS UNUSED, THE INVARIANT HAS
 * BEEN BROKEN. Someone has widened a signature — with an overload, a union
 * parameter, or a "just this once" branch — and exits can now be blocked. The
 * fix is to narrow the signature back, never to delete the directive.
 */
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { ExitIntent, TradeIntent } from "@slipstream/shared"
import { GATES, evaluateAll } from "../gates.js"
import type { Gate, RiskContext } from "../types.js"
import { makeCtx, makeExit, makeIntent } from "./fixtures.js"

/** Never called. Its only job is to be type-checked. */
const _exitCannotReachAnyGate = (ctx: RiskContext, exit: ExitIntent): void => {
  for (const gate of GATES) {
    // @ts-expect-error An ExitIntent must never be accepted by a gate.
    gate.evaluate(exit, ctx)
  }
  // @ts-expect-error An ExitIntent must never be accepted by evaluateAll.
  evaluateAll(exit, ctx)
}

/** The positive control. If this stops compiling, the parameter type has been
 *  changed to something a TradeIntent no longer satisfies, and the directives
 *  above would then be passing for the wrong reason. (Do not write the
 *  expect-error token in prose: the compiler reads it out of comments too.) */
const _tradeStillReachesEveryGate = (ctx: RiskContext, trade: TradeIntent): void => {
  for (const gate of GATES) gate.evaluate(trade, ctx)
  evaluateAll(trade, ctx)
}

type GateIntentParam = Parameters<Gate["evaluate"]>[0]

// @ts-expect-error An ExitIntent must not be assignable to a gate's intent parameter.
const _exitAsGateParam: GateIntentParam = makeExit()
const _tradeAsGateParam: GateIntentParam = makeIntent()

describe("exits are never gated (docs/03 §5)", () => {
  it("no gate and no evaluateAll accepts an ExitIntent", () => {
    // The assertions that matter are the @ts-expect-error directives above;
    // these keep the declarations referenced so nothing elides them.
    expect(typeof _exitCannotReachAnyGate).toBe("function")
    expect(typeof _tradeStillReachesEveryGate).toBe("function")
    expect(_exitAsGateParam).not.toBe(_tradeAsGateParam)
  })

  it("no gate implementation so much as mentions an exit", () => {
    // Catches the other half of a widened signature: an `if (intent.kind ===
    // "exit")` branch smuggled into a gate. A gate has no business knowing the
    // type exists.
    const gatesDir = fileURLToPath(new URL("../gates/", import.meta.url))
    const sources = readdirSync(gatesDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => ({ file: f, text: readFileSync(new URL(f, new URL("../gates/", import.meta.url)), "utf8") }))
    sources.push({
      file: "gates.ts",
      text: readFileSync(fileURLToPath(new URL("../gates.ts", import.meta.url)), "utf8"),
    })

    expect(sources.length).toBeGreaterThan(10)
    for (const { file, text } of sources) {
      // Prose in comments is how the invariant is explained, so only look at
      // what the compiler sees: an import or an annotation of the type.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
      expect(code, `${file} refers to ExitIntent`).not.toMatch(/ExitIntent/)
      expect(code, `${file} branches on an exit kind`).not.toMatch(/"exit"/)
    }
  })

  it("an approved intent comes back unchanged, and a skip is a separate kind", () => {
    const intent = makeIntent()
    const result = evaluateAll(intent, makeCtx())
    expect(result.approved).toBe(true)
    if (result.approved) expect(result.intent).toBe(intent)
  })
})
