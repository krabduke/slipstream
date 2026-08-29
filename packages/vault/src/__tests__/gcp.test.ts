import { describe, expect, it } from "vitest"
import { revealSignerKey } from "@slipstream/shared/secret.js"
import { VaultAuthError } from "../crypto.js"
import { createGcpKmsVault, type GcpKmsClient } from "../gcp.js"
import type { SealedKey } from "../types.js"

const PLAINTEXT = "0x9d2f6b1c4e7a0c8f5b3d9e1f7a2c4e6b8d0f1a3c5e7b9d1f3a5c7e9b1d3f5a7"
const AAD = "va_poly_3003"
const KEY_VERSION = "projects/p/locations/global/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1"

const capturedKey = async (
  vault: { withKey: ReturnType<typeof createGcpKmsVault>["withKey"] },
  sealed: SealedKey,
  aad: string,
): Promise<string> => {
  let captured = ""
  await vault.withKey(sealed, aad, async (key) => {
    captured = revealSignerKey(key)
    return null
  })
  return captured
}

const makeFakeGcp = () => {
  const blobs = new Map<string, Buffer>()
  const dekRefs: Buffer[] = []
  let counter = 0
  const client: GcpKmsClient = {
    async cryptoKeyEncrypt(req) {
      dekRefs.push(Buffer.from(req.plaintext))
      const id = `${KEY_VERSION}#wrap/${++counter}`
      blobs.set(id, Buffer.from(req.plaintext))
      return [{ ciphertext: Buffer.from(id, "utf8") }]
    },
    async cryptoKeyDecrypt(req) {
      const id =
        typeof req.ciphertext === "string"
          ? req.ciphertext
          : Buffer.from(req.ciphertext).toString("utf8")
      const snapshot = blobs.get(id)
      if (!snapshot) throw new Error("unknown ciphertext")
      return [{ plaintext: Buffer.from(snapshot) }]
    },
  }
  return { client, dekRefs }
}

const vaultWith = () => {
  const fake = makeFakeGcp()
  const vault = createGcpKmsVault({ cryptoKeyVersion: KEY_VERSION, loadClient: async () => fake.client })
  return { vault, fake }
}

describe("gcp vault — SDK detection", () => {
  it("throws a clear 'SDK not installed' error at construction", () => {
    expect(() => createGcpKmsVault({ cryptoKeyVersion: KEY_VERSION })).toThrow(/google-cloud\/kms/)
  })

  it("requires a cryptoKeyVersion", () => {
    const fake = makeFakeGcp()
    expect(() => createGcpKmsVault({ cryptoKeyVersion: "", loadClient: async () => fake.client })).toThrow(
      /cryptoKeyVersion/,
    )
  })
})

describe("gcp vault — envelope behaviour via fake KMS", () => {
  it("seal -> withKey round-trips the exact plaintext", async () => {
    const { vault } = vaultWith()
    const sealed = await vault.seal(PLAINTEXT, AAD)
    expect(sealed.kmsKeyId).toBe(KEY_VERSION)
    expect(await capturedKey(vault, sealed, AAD)).toBe(PLAINTEXT)
  })

  it("decrypting with the wrong aad fails authentication", async () => {
    const { vault } = vaultWith()
    const sealed = await vault.seal(PLAINTEXT, AAD)
    await expect(vault.withKey(sealed, "va_poly_9999", async () => "never")).rejects.toThrow(VaultAuthError)
  })

  it("a tampered ciphertext byte fails authentication", async () => {
    const { vault } = vaultWith()
    const sealed = await vault.seal(PLAINTEXT, AAD)
    const bytes = Buffer.from(sealed.ciphertext, "base64")
    bytes[0] = (bytes[0] ?? 0) ^ 0xff
    const tampered: SealedKey = { ...sealed, ciphertext: bytes.toString("base64") }
    await expect(vault.withKey(tampered, AAD, async () => "never")).rejects.toThrow(VaultAuthError)
  })

  it("two seals of the same plaintext differ (fresh DEK + IV)", async () => {
    const { vault } = vaultWith()
    const a = await vault.seal(PLAINTEXT, AAD)
    const b = await vault.seal(PLAINTEXT, AAD)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.iv).not.toBe(b.iv)
    expect(a.wrappedDek).not.toBe(b.wrappedDek)
  })

  it("withKey returns a derived value and refuses the raw key", async () => {
    const { vault } = vaultWith()
    const sealed = await vault.seal(PLAINTEXT, AAD)
    const derived = await vault.withKey(sealed, AAD, async (key) => revealSignerKey(key).length)
    expect(derived).toBe(PLAINTEXT.length)
    await expect(vault.withKey(sealed, AAD, async (key) => revealSignerKey(key))).rejects.toThrow(
      /must not return the plaintext key/,
    )
  })

  it("rewraps the DEK under a new key version without touching ciphertext", async () => {
    const { vault } = vaultWith()
    const sealed = await vault.seal(PLAINTEXT, AAD)
    const nextVersion = `${KEY_VERSION.slice(0, -1)}2`
    const rewrapped = await vault.rewrap(sealed, nextVersion)
    expect(rewrapped.kmsKeyId).toBe(nextVersion)
    expect(rewrapped.ciphertext).toBe(sealed.ciphertext)
    expect(rewrapped.wrappedDek).not.toBe(sealed.wrappedDek)
    expect(await capturedKey(vault, rewrapped, AAD)).toBe(PLAINTEXT)
  })
})
