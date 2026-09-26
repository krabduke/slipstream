import { describe, expect, it } from "vitest"
import { generateEngineKeypair, openAgentKey, sealAgentKey } from "../seal.js"

const KEY = `0x${"ab".repeat(32)}`
const binding = { venue: "hyperliquid", owner: "0xOwner0000000000000000000000000000000001", agent: "0xAgent0000000000000000000000000000000002" }

describe("agent key sealing", () => {
  it("round-trips through the engine's private key", async () => {
    const kp = await generateEngineKeypair()
    const sealed = await sealAgentKey(kp.publicKey, binding, KEY)
    expect(sealed.ciphertext).not.toContain("abab")
    expect(sealed.keyId).toBe(kp.keyId)
    expect(await openAgentKey(kp.privateKey, binding, sealed)).toBe(KEY)
  })

  it("refuses to open under a different owner or agent (row swap)", async () => {
    const kp = await generateEngineKeypair()
    const sealed = await sealAgentKey(kp.publicKey, binding, KEY)
    await expect(openAgentKey(kp.privateKey, { ...binding, owner: "0x" + "9".repeat(40) }, sealed)).rejects.toThrow()
    await expect(openAgentKey(kp.privateKey, { ...binding, agent: "0x" + "8".repeat(40) }, sealed)).rejects.toThrow()
  })

  it("refuses tampered ciphertext and a different engine key", async () => {
    const kp = await generateEngineKeypair()
    const other = await generateEngineKeypair()
    const sealed = await sealAgentKey(kp.publicKey, binding, KEY)
    const flipped = { ...sealed, tag: sealed.tag.startsWith("A") ? "B" + sealed.tag.slice(1) : "A" + sealed.tag.slice(1) }
    await expect(openAgentKey(kp.privateKey, binding, flipped)).rejects.toThrow()
    await expect(openAgentKey(other.privateKey, binding, sealed)).rejects.toThrow()
  })
})
