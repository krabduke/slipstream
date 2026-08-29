import { describe, expect, it } from "vitest"
import { createLogger } from "@slipstream/shared/log/index.js"
import { revealSignerKey } from "@slipstream/shared/secret.js"
import type { SealedKey } from "../types.js"
import { VaultAuthError } from "../crypto.js"
import { createLocalFileVault } from "../local.js"

const PLAINTEXT = "0x7c9e667193aec36e6a548b774400d3f0e6f8d5c2b1a09f8e7d6c5b4a3928170"
const AAD = "va_live_1001"
const MASTER = "aa".repeat(32) // 64-hex -> 32-byte master key
const ROTATED = "bb".repeat(32)

/** Silence the loud startup warning unless a test is asserting on it. */
const quiet = { logger: createLogger({ level: "error", sink: () => {} }) }

/** Decrypt and capture the plaintext *inside* the callback; withKey refuses to
 *  return the key, so this is the sanctioned way to observe a round-trip. */
const capturedKey = async (vault: { withKey: ReturnType<typeof createLocalFileVault>["withKey"] }, sealed: SealedKey, aad: string): Promise<string> => {
  let captured = ""
  await vault.withKey(sealed, aad, async (key) => {
    captured = revealSignerKey(key)
    return null
  })
  return captured
}

describe("local vault — envelope round-trip", () => {
  const vault = createLocalFileVault({ masterKey: MASTER, keyId: "v1", ...quiet })

  it("seal -> withKey round-trips the exact plaintext", async () => {
    const sealed = await vault.seal(PLAINTEXT, AAD)
    expect(await capturedKey(vault, sealed, AAD)).toBe(PLAINTEXT)
  })

  it("decrypting with the wrong aad fails authentication", async () => {
    const sealed = await vault.seal(PLAINTEXT, AAD)
    await expect(vault.withKey(sealed, "va_live_2002", async () => "never")).rejects.toThrow(
      VaultAuthError,
    )
  })

  it("a single flipped ciphertext byte fails authentication", async () => {
    const sealed = await vault.seal(PLAINTEXT, AAD)
    const bytes = Buffer.from(sealed.ciphertext, "base64")
    bytes[0] = (bytes[0] ?? 0) ^ 0xff
    const tampered: SealedKey = { ...sealed, ciphertext: bytes.toString("base64") }
    await expect(vault.withKey(tampered, AAD, async () => "never")).rejects.toThrow(VaultAuthError)
  })

  it("two seals of the same plaintext produce different ciphertexts", async () => {
    const a = await vault.seal(PLAINTEXT, AAD)
    const b = await vault.seal(PLAINTEXT, AAD)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.iv).not.toBe(b.iv)
    expect(a.wrappedDek).not.toBe(b.wrappedDek)
  })

  it("withKey returns the derived value, never the key", async () => {
    const sealed = await vault.seal(PLAINTEXT, AAD)
    const sig = await vault.withKey(sealed, AAD, async (key) => `signed:${revealSignerKey(key).slice(0, 6)}`)
    expect(sig).toBe("signed:0x7c9e")
    expect(sig).not.toContain(PLAINTEXT)
  })

  it("refuses to hand the plaintext key back", async () => {
    const sealed = await vault.seal(PLAINTEXT, AAD)
    await expect(vault.withKey(sealed, AAD, async (key) => revealSignerKey(key))).rejects.toThrow(
      /must not return the plaintext key/,
    )
  })

  it("rewraps the DEK under a new key id without touching ciphertext", async () => {
    const rotating = createLocalFileVault({
      masterKey: MASTER,
      keyId: "v1",
      additionalKeys: { v2: ROTATED },
      ...quiet,
    })
    const sealed = await rotating.seal(PLAINTEXT, AAD)
    const rewrapped = await rotating.rewrap(sealed, "v2")
    expect(rewrapped.kmsKeyId).toBe("v2")
    expect(rewrapped.wrappedDek).not.toBe(sealed.wrappedDek)
    expect(rewrapped.ciphertext).toBe(sealed.ciphertext)
    // Still decryptable, now under the rotated master.
    expect(await capturedKey(rotating, rewrapped, AAD)).toBe(PLAINTEXT)
  })
})

describe("local vault — master key handling", () => {
  it("fails loudly when the master-key env var is missing", () => {
    expect(() => createLocalFileVault({ env: {}, ...quiet })).toThrow(/LOCAL_MASTER_KEY/)
  })

  it("fails loudly on a blank master key", () => {
    expect(() => createLocalFileVault({ env: { LOCAL_MASTER_KEY: "   " }, ...quiet })).toThrow(
      /LOCAL_MASTER_KEY/,
    )
  })

  it("reads the master key from the environment and is deterministic across restarts", async () => {
    const one = createLocalFileVault({ env: { LOCAL_MASTER_KEY: MASTER }, keyId: "v1", ...quiet })
    const sealed = await one.seal(PLAINTEXT, AAD)
    // A fresh "boot" with the same env decrypts what the previous one sealed.
    const two = createLocalFileVault({ env: { LOCAL_MASTER_KEY: MASTER }, keyId: "v1", ...quiet })
    expect(await capturedKey(two, sealed, AAD)).toBe(PLAINTEXT)
  })

  it("a different master key cannot read the ciphertext", async () => {
    const one = createLocalFileVault({ masterKey: MASTER, keyId: "v1", ...quiet })
    const sealed = await one.seal(PLAINTEXT, AAD)
    const attacker = createLocalFileVault({ masterKey: ROTATED, keyId: "v1", ...quiet })
    await expect(attacker.withKey(sealed, AAD, async () => "never")).rejects.toThrow(VaultAuthError)
  })
})

describe("local vault — startup warning", () => {
  it("logs a loud not-equivalent-to-a-KMS warning that omits the master key", () => {
    const lines: string[] = []
    createLocalFileVault({
      masterKey: MASTER,
      keyId: "v1",
      logger: createLogger({ level: "warn", sink: (l) => lines.push(l) }),
    })
    const joined = lines.join("")
    expect(joined).toContain("not equivalent")
    expect(joined).toContain('"level":"warn"')
    // The warning names the backend/key id but must never carry the key itself.
    expect(joined).not.toContain(MASTER)
  })
})
