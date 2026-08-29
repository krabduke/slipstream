import { describe, expect, it } from "vitest"
import { revealSignerKey } from "@slipstream/shared/secret.js"
import type { SealedKey } from "../types.js"
import {
  VaultAuthError,
  decryptEnvelope,
  encryptEnvelope,
  generateDek,
  runWithKey,
  zeroBuffer,
} from "../crypto.js"

const PLAINTEXT = "0x5f3e8a1b9c0d2e4f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0"
const AAD = "venue_account_42"

const sealWith = (dek: Buffer, plaintext = PLAINTEXT, aad = AAD): SealedKey => ({
  ...encryptEnvelope(dek, plaintext, aad),
  wrappedDek: "unused-in-crypto-layer",
  kmsKeyId: "test-key",
  aad,
})

/** Flip a bit in a base64 field without a noUncheckedIndexedAccess dance. */
const flipBase64 = (value: string, index: number): string => {
  const bytes = Buffer.from(value, "base64")
  const at = index < 0 ? bytes.length + index : index
  bytes[at] = (bytes[at] ?? 0) ^ 0xff
  return bytes.toString("base64")
}

describe("crypto — AES-256-GCM envelope", () => {
  it("round-trips the exact plaintext with the right aad", () => {
    const dek = generateDek()
    const sealed = sealWith(dek)
    const back = decryptEnvelope(dek, sealed, AAD)
    expect(back.toString("utf8")).toBe(PLAINTEXT)
    zeroBuffer(back)
  })

  it("decrypting with the wrong aad throws instead of returning garbage", () => {
    const dek = generateDek()
    const sealed = sealWith(dek)
    expect(() => decryptEnvelope(dek, sealed, "venue_account_99")).toThrow(VaultAuthError)
  })

  it("a single flipped ciphertext byte fails authentication", () => {
    const dek = generateDek()
    const sealed = sealWith(dek)
    const tampered: SealedKey = { ...sealed, ciphertext: flipBase64(sealed.ciphertext, 0) }
    expect(() => decryptEnvelope(dek, tampered, AAD)).toThrow(VaultAuthError)
  })

  it("a single flipped tag byte fails authentication", () => {
    const dek = generateDek()
    const sealed = sealWith(dek)
    const tampered: SealedKey = { ...sealed, tag: flipBase64(sealed.tag, -1) }
    expect(() => decryptEnvelope(dek, tampered, AAD)).toThrow(VaultAuthError)
  })

  it("two seals of the same plaintext differ (fresh IV each time)", () => {
    const dek = generateDek()
    const a = encryptEnvelope(dek, PLAINTEXT, AAD)
    const b = encryptEnvelope(dek, PLAINTEXT, AAD)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.iv).not.toBe(b.iv)
    expect(a.tag).not.toBe(b.tag)
  })

  it("generateDek yields fresh 32-byte keys", () => {
    const a = generateDek()
    const b = generateDek()
    expect(a.length).toBe(32)
    expect(b.length).toBe(32)
    expect(a.equals(b)).toBe(false)
  })

  it("rejects a corrupt base64 field loudly rather than shorting silently", () => {
    const dek = generateDek()
    const sealed = sealWith(dek)
    const corrupt: SealedKey = { ...sealed, iv: "###not-base64###" }
    expect(() => decryptEnvelope(dek, corrupt, AAD)).toThrow(/well-formed|authentication/)
  })
})

describe("crypto — runWithKey is the only decryption path", () => {
  it("passes the key into the callback and returns the callback's value, not the key", async () => {
    const dek = generateDek()
    const sealed = sealWith(dek)
    let seen = ""
    const result = await runWithKey(dek, sealed, AAD, async (key) => {
      seen = revealSignerKey(key)
      return `sig(${seen.length})`
    })
    expect(seen).toBe(PLAINTEXT)
    expect(result).toBe(`sig(${PLAINTEXT.length})`)
    expect(result).not.toBe(PLAINTEXT)
  })

  it("zeroes the DEK after the callback resolves", async () => {
    const dek = generateDek()
    const sealed = sealWith(dek)
    await runWithKey(dek, sealed, AAD, async () => "ok")
    expect(dek.every((byte) => byte === 0)).toBe(true)
  })

  it("zeroes the DEK even when the callback throws", async () => {
    const dek = generateDek()
    const sealed = sealWith(dek)
    await expect(
      runWithKey(dek, sealed, AAD, async () => {
        throw new Error("signing blew up")
      }),
    ).rejects.toThrow("signing blew up")
    expect(dek.every((byte) => byte === 0)).toBe(true)
  })

  it("refuses a callback that tries to hand the key back as its return value", async () => {
    const dek = generateDek()
    const sealed = sealWith(dek)
    await expect(
      runWithKey(dek, sealed, AAD, async (key) => revealSignerKey(key)),
    ).rejects.toThrow(/must not return the plaintext key/)
  })

  it("fails authentication on a wrong aad before the callback is ever called", async () => {
    const dek = generateDek()
    const sealed = sealWith(dek)
    let called = false
    await expect(
      runWithKey(dek, sealed, "wrong_aad", async () => {
        called = true
        return "x"
      }),
    ).rejects.toThrow(VaultAuthError)
    expect(called).toBe(false)
  })
})
