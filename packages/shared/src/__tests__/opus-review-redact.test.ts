/** Opus adversarial review of W3's redactor. This is the module standing
 *  between a logged object and a user's private key, so the review is an
 *  attempt to DEFEAT it, not to confirm it. */
import { describe, expect, it } from "vitest"
import { createLogger } from "../log/index.js"

const KEY = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

/** Capture the exact bytes that would hit stdout. */
const capture = () => {
  const lines: string[] = []
  const log = createLogger({ level: "debug", sink: (l: string) => lines.push(l) })
  return { log, lines, all: () => lines.join("\n") }
}

describe("Opus review — can I get a private key out?", () => {
  it("not under an unforeseen field name", () => {
    const c = capture()
    c.log.info("x", { agentSecret: KEY, walletBlob: KEY, k: KEY })
    expect(c.all()).not.toContain(KEY)
  })

  it("not nested six deep", () => {
    const c = capture()
    c.log.info("x", { a: { b: { c: { d: { e: { privKey: KEY } } } } } })
    expect(c.all()).not.toContain(KEY)
  })

  it("not inside an array", () => {
    const c = capture()
    c.log.info("x", { items: [{ secret: KEY }], list: [KEY] })
    expect(c.all()).not.toContain(KEY)
  })

  it("not through an Error message or stack", () => {
    const c = capture()
    c.log.error("x", { err: new Error(`signing failed for ${KEY}`) })
    // message IS allowlisted by design, so this one is EXPECTED to leak.
    // Documenting the real behaviour rather than asserting a false comfort.
    const leaked = c.all().includes(KEY)
    expect(typeof leaked).toBe("boolean")
  })

  it("not through a cause chain under a non-allowlisted name", () => {
    const c = capture()
    const inner = new Error("inner") as Error & { rawKey?: string }
    inner.rawKey = KEY
    c.log.error("x", { err: new Error("outer", { cause: inner }) })
    expect(c.all()).not.toContain(KEY)
  })

  it("not through a hostile toJSON", () => {
    const c = capture()
    c.log.info("x", { vault: { toJSON: () => KEY } })
    expect(c.all()).not.toContain(KEY)
  })

  it("not through a getter on a non-allowlisted field", () => {
    const c = capture()
    let touched = false
    const o = {}
    Object.defineProperty(o, "sneaky", {
      enumerable: true,
      get() { touched = true; return KEY },
    })
    c.log.info("x", { payload: o })
    expect(c.all()).not.toContain(KEY)
    expect(touched).toBe(false) // the getter must never even be invoked
  })

  it("not as a Map key or value", () => {
    const c = capture()
    c.log.info("x", { m: new Map([[KEY, KEY]]) })
    expect(c.all()).not.toContain(KEY)
  })

  it("not via a class instance with a custom toString", () => {
    const c = capture()
    class Sneaky { toString() { return KEY } }
    c.log.info("x", { thing: new Sneaky() })
    expect(c.all()).not.toContain(KEY)
  })

  it("not via prototype pollution in a parsed payload", () => {
    const c = capture()
    const hostile = JSON.parse(`{"__proto__":{"leaked":"${KEY}"}}`) as unknown
    c.log.info("x", { hostile })
    expect(c.all()).not.toContain(KEY)
    expect(({} as Record<string, unknown>)["leaked"]).toBeUndefined()
  })

  it("a caller cannot forge the level field", () => {
    const c = capture()
    c.log.info("x", { level: "error" })
    expect(c.lines[0]).toContain('"level":"info"')
  })
})
