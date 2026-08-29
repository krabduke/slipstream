/** Opus review addition: the allowlist cannot protect a legitimately free-text
 *  field, so key-shaped values are masked wherever they are emitted. */
import { describe, expect, it } from "vitest"
import { createLogger } from "../log/index.js"

const KEY = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

const capture = () => {
  const lines: string[] = []
  return { log: createLogger({ level: "debug", sink: (l: string) => lines.push(l) }), lines }
}

describe("Opus review — key-shaped values never survive, even in free text", () => {
  it("an Error message interpolating a key no longer leaks it", () => {
    const c = capture()
    c.log.error("sign failed", { err: new Error(`signing failed for ${KEY}`) })
    expect(c.lines.join("")).not.toContain(KEY)
    expect(c.lines.join("")).toContain("[redacted:64hex]")
  })

  it("a 0x-prefixed key in a message is masked too", () => {
    const c = capture()
    c.log.error("x", { err: new Error(`key=0x${KEY}`) })
    expect(c.lines.join("")).not.toContain(KEY)
  })

  it("an allowlisted string field carrying a key is masked", () => {
    const c = capture()
    c.log.info("x", { msg: KEY, message: KEY })
    expect(c.lines.join("")).not.toContain(KEY)
  })

  it("ordinary short hex is untouched", () => {
    const c = capture()
    c.log.info("x", { message: "market 0xdeadbeef ok" })
    expect(c.lines.join("")).toContain("0xdeadbeef")
  })
})
