/**
 * Tests for the allowlist log redactor.
 *
 * These are not coverage exercises. Each one corresponds to a claim in
 * docs/04 section 2 or docs/01 section 6, and the first four are the reason the
 * module exists: a field nobody anticipated must not reach the output, at any
 * depth, on an error as readily as on a plain object.
 *
 * Assertions are made against the raw emitted line wherever the question is
 * "did this string escape", because that is the actual property -- an assertion
 * on a parsed object can pass while the secret sits in a stack trace beside it.
 */
import fc from "fast-check"
import { beforeEach, describe, expect, it } from "vitest"
import { LOG_ALLOWLIST, createLogger, isAllowedField, redact, redactFields } from "../log/index.js"
import type { LogFields } from "../log/index.js"

/** A plaintext agent key is 32 bytes of hex. Nothing else in a trading system
 *  looks like this except a transaction hash, which carries an 0x prefix. */
const KEY_SHAPED = "a3f1c09d4e8b27a651df0c93be74a2158cd6e0fb39a4712c85de63b0f4a91c7d"

const capture = () => {
  const lines: string[] = []
  return {
    lines,
    sink: (line: string) => {
      lines.push(line)
    },
    /** Everything written, as one string. The question "did it leak" is asked
     *  of the bytes, not of a parsed shape. */
    text: () => lines.join(""),
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

describe("allowlist", () => {
  it("contains no field name that could plausibly hold a credential", () => {
    // A tripwire, not a denylist: the redactor never consults this array. If
    // somebody adds one of these names to the allowlist, the diff that does it
    // fails here rather than shipping quietly.
    const forbidden = [
      "key",
      "apiKey",
      "secret",
      "password",
      "privateKey",
      "agentKey",
      "signerKey",
      "token",
      "authorization",
      "headers",
      "body",
      "payload",
      "data",
      "raw",
      "response",
      "params",
      "query",
      "url",
      // Not credentials, but allowlisting any of these would let a crafted
      // field name write through `Object.prototype` while building the entry.
      "__proto__",
      "constructor",
      "prototype",
    ]
    for (const name of forbidden) {
      expect(isAllowedField(name), `"${name}" must not be allowlisted`).toBe(false)
    }
  })

  it("cannot be widened at runtime", () => {
    // The exported type is ReadonlySet, so there is no compile-time way in.
    // This asserts the runtime object is not quietly something else, e.g. an
    // array that a caller could push onto.
    expect(LOG_ALLOWLIST).toBeInstanceOf(Set)
    expect(Object.keys(LOG_ALLOWLIST)).toHaveLength(0)
  })
})

describe("redactor: the leak paths", () => {
  let out: ReturnType<typeof capture>
  beforeEach(() => {
    out = capture()
  })

  it("drops a key-shaped string under a non-allowlisted field name", () => {
    const log = createLogger({ sink: out.sink })
    log.info("key stored", { agentPrivateKey: KEY_SHAPED, userId: "u_1" } as LogFields)

    expect(out.text()).not.toContain(KEY_SHAPED)
    expect(out.text()).not.toContain("agentPrivateKey")
    // And the line is still useful: the allowlisted sibling survives.
    expect(out.entries()[0]).toMatchObject({ msg: "key stored", userId: "u_1" })
  })

  it("drops it under a deeply nested non-allowlisted field name", () => {
    const log = createLogger({ sink: out.sink })
    log.info("nested", {
      detail: {
        // Allowlisted the whole way down, so the walk genuinely descends
        // rather than discarding the branch at the first hop.
        detail: {
          detail: {
            reason: "leader_closed",
            vaultMaterial: KEY_SHAPED,
          },
        },
      },
    } as LogFields)

    expect(out.text()).not.toContain(KEY_SHAPED)
    expect(out.text()).not.toContain("vaultMaterial")
    // The proof that this was a leaf-level drop and not a whole-branch drop:
    // its allowlisted sibling at the same depth is present.
    expect(out.text()).toContain("leader_closed")
  })

  it("drops a field name nobody thought of, for any name at all", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }).filter((name) => !LOG_ALLOWLIST.has(name)),
        (name) => {
          const local = capture()
          const log = createLogger({ sink: local.sink })
          log.info("generated", { [name]: KEY_SHAPED } as LogFields)
          return !local.text().includes(KEY_SHAPED)
        },
      ),
      { numRuns: 500 },
    )
  })

  it("redacts an Error's cause chain exactly as it redacts a plain object", () => {
    const root = new Error("vault unwrap failed")
    Object.assign(root, { wrappedDek: KEY_SHAPED, code: "EUNWRAP" })

    const middle = new Error("decrypt failed", { cause: root })
    Object.assign(middle, { plaintext: KEY_SHAPED })

    const top = new Error("sign failed", { cause: middle })

    const log = createLogger({ sink: out.sink })
    log.error("could not sign order", { err: top, venue: "hyperliquid" } as LogFields)

    const text = out.text()
    expect(text).not.toContain(KEY_SHAPED)
    expect(text).not.toContain("wrappedDek")
    expect(text).not.toContain("plaintext")

    // The chain itself survives, minus the parts that were never opted in.
    const entry = out.entries()[0] as unknown as {
      err: { message: string; cause: { message: string; cause: { message: string; code: string } } }
    }
    expect(entry.err.message).toBe("sign failed")
    expect(entry.err.cause.message).toBe("decrypt failed")
    expect(entry.err.cause.cause.message).toBe("vault unwrap failed")
    expect(entry.err.cause.cause.code).toBe("EUNWRAP")
  })

  it("redacts a non-Error thrown object with extra properties", () => {
    // `throw { ... }` is legal and the redactor must not assume Error.
    const thrown: unknown = { message: "venue rejected", sessionSigner: KEY_SHAPED }
    const log = createLogger({ sink: out.sink })
    log.error("caught", { err: thrown } as LogFields)

    expect(out.text()).not.toContain(KEY_SHAPED)
    expect(out.text()).toContain("venue rejected")
  })

  it("redacts an error nested inside an AggregateError", () => {
    const child = new Error("child failed")
    Object.assign(child, { dek: KEY_SHAPED })
    const aggregate = new AggregateError([child], "all venues failed")

    const log = createLogger({ sink: out.sink })
    log.error("batch failed", { err: aggregate } as LogFields)

    expect(out.text()).not.toContain(KEY_SHAPED)
    expect(out.text()).toContain("child failed")
  })

  it("does not honour toJSON, which would bypass the allowlist entirely", () => {
    const sneaky = {
      userId: "u_1",
      toJSON: () => ({ everything: KEY_SHAPED }),
    }
    const log = createLogger({ sink: out.sink })
    log.info("object with toJSON", { detail: sneaky } as LogFields)

    expect(out.text()).not.toContain(KEY_SHAPED)
    expect(out.entries()[0]).toMatchObject({ detail: { userId: "u_1" } })
  })

  it("drops binary values even under an allowlisted field name", () => {
    // Raw key material arrives as bytes, and a Buffer has no field names to
    // filter, so the allowlist has nothing to bite on. It is dropped instead.
    expect(redact({ detail: Buffer.from(KEY_SHAPED, "hex"), size: 32 })).toEqual({ size: 32 })
    expect(redact({ detail: new Uint8Array([1, 2, 3]) })).toEqual({})
  })

  it("never invokes a getter under a non-allowlisted name", () => {
    let read = false
    const probe = {
      get harvestedKey() {
        read = true
        return KEY_SHAPED
      },
    }
    const log = createLogger({ sink: out.sink })
    log.info("getter", { detail: probe } as LogFields)

    expect(read).toBe(false)
    expect(out.text()).not.toContain(KEY_SHAPED)
  })

  it("reports a throwing getter rather than silently omitting the field", () => {
    const probe = {
      get reason(): string {
        throw new Error("boom")
      },
    }
    expect(redact(probe)).toEqual({ reason: "[getter-threw]" })
  })
})

describe("redactor: JSON safety", () => {
  it("survives a cycle", () => {
    const node: Record<string, unknown> = { reason: "orphan" }
    node["detail"] = node
    expect(() => JSON.stringify(redact(node))).not.toThrow()
    expect(redact(node)).toEqual({ reason: "orphan", detail: "[circular]" })
  })

  it("cuts off beyond the depth budget instead of recursing forever", () => {
    let deep: Record<string, unknown> = { reason: "bottom" }
    for (let i = 0; i < 40; i += 1) deep = { detail: deep }
    const result = JSON.stringify(redact(deep))
    expect(result).toContain("[max-depth]")
    expect(result).not.toContain("bottom")
  })

  it("converts values JSON.stringify would throw on or silently mangle", () => {
    expect(redact({ size: 10n })).toEqual({ size: "10" })
    expect(redact({ price: Number.NaN })).toEqual({ price: "NaN" })
    expect(redact({ price: Number.POSITIVE_INFINITY })).toEqual({ price: "Infinity" })
    expect(redact({ ts: new Date(0) })).toEqual({ ts: "1970-01-01T00:00:00.000Z" })
    expect(redact({ ts: new Date(Number.NaN) })).toEqual({ ts: "[invalid-date]" })
    expect(redact({ reason: undefined })).toEqual({})
    expect(redact({ reason: () => 1 })).toEqual({})
  })

  it("applies the allowlist to Map keys and preserves array positions", () => {
    const map = new Map<unknown, unknown>([
      ["reason", "orphan"],
      ["stolenKey", KEY_SHAPED],
      [42, KEY_SHAPED],
    ])
    expect(redact({ detail: map })).toEqual({ detail: { reason: "orphan" } })

    // A dropped element becomes null rather than shifting every later index.
    expect(redact({ errors: ["a", () => 1, "b"] })).toEqual({ errors: ["a", null, "b"] })
    expect(redact({ detail: new Set(["a", "b"]) })).toEqual({ detail: ["a", "b"] })
  })

  it("yields an empty object for fields that have no field names at all", () => {
    expect(redactFields(undefined)).toEqual({})
    expect(redactFields(null)).toEqual({})
    expect(redactFields("just a string")).toEqual({})
    expect(redactFields([1, 2, 3])).toEqual({})
  })

  it("accommodates a bare Error passed where fields were expected", () => {
    const result = redactFields(new Error("boom"))
    expect(result).toMatchObject({ err: { message: "boom", name: "Error" } })
  })
})

describe("logger", () => {
  let out: ReturnType<typeof capture>
  beforeEach(() => {
    out = capture()
  })

  it("writes one JSON object per line", () => {
    const log = createLogger({ sink: out.sink, now: () => new Date(1_700_000_000_000) })
    log.info("first", { userId: "u_1" })
    log.warn("second")

    expect(out.lines).toHaveLength(2)
    for (const line of out.lines) expect(line.endsWith("\n")).toBe(true)
    expect(out.entries()[0]).toEqual({
      time: "2023-11-14T22:13:20.000Z",
      level: "info",
      msg: "first",
      userId: "u_1",
    })
    expect(out.entries()[1]).toEqual({
      time: "2023-11-14T22:13:20.000Z",
      level: "warn",
      msg: "second",
    })
  })

  it("filters below the configured level", () => {
    const log = createLogger({ sink: out.sink, level: "warn" })
    log.debug("no")
    log.info("no")
    log.warn("yes")
    log.error("yes")

    expect(out.entries().map((e) => e["msg"])).toEqual(["yes", "yes"])
    expect(log.isLevelEnabled("info")).toBe(false)
    expect(log.isLevelEnabled("error")).toBe(true)
  })

  it("cannot have its envelope forged by caller fields", () => {
    const log = createLogger({ sink: out.sink, now: () => new Date(0) })
    log.error("real message", {
      level: "debug",
      msg: "fake message",
      time: "yesterday",
    } as LogFields)

    expect(out.entries()[0]).toEqual({
      time: "1970-01-01T00:00:00.000Z",
      level: "error",
      msg: "real message",
    })
  })

  it("merges child bindings, with per-call fields winning", () => {
    const root = createLogger({ sink: out.sink, bindings: { service: "engine" } })
    const child = root.child({ userId: "u_1", venue: "hyperliquid" })
    child.info("tick", { venue: "polymarket" })

    expect(out.entries()[0]).toMatchObject({
      service: "engine",
      userId: "u_1",
      venue: "polymarket",
    })
  })

  it("redacts bindings too", () => {
    const log = createLogger({ sink: out.sink, bindings: { bootKey: KEY_SHAPED } as LogFields })
    log.child({ alsoSecret: KEY_SHAPED } as LogFields).info("hello")
    expect(out.text()).not.toContain(KEY_SHAPED)
  })

  it("does not mutate the fields it is given", () => {
    const fields = { userId: "u_1", agentKey: KEY_SHAPED }
    createLogger({ sink: out.sink }).info("x", fields as LogFields)
    expect(fields.agentKey).toBe(KEY_SHAPED)
  })
})
