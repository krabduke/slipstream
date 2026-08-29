import { describe, expect, it } from "vitest"
import { revealSignerKey } from "@slipstream/shared/secret.js"
import { VaultAuthError } from "../crypto.js"
import { createAwsKmsVault, type AwsKmsSdk } from "../aws.js"
import type { SealedKey } from "../types.js"

const PLAINTEXT = "0x3a9f1c7e5d2b80a6f4e1c9b7d3a5f8e2c6b0a9d7e5f3c1b9a7d5e3f1c9b7a5d3"
const AAD = "va_hl_2002"

const capturedKey = async (
  vault: { withKey: ReturnType<typeof createAwsKmsVault>["withKey"] },
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

/** A stand-in for `@aws-sdk/client-kms` that keeps a KMS-encrypted DEK blob so
 *  the backend's wrap/unwrap + zeroing behaviour is testable without the SDK. */
const makeFakeAws = () => {
  const blobs = new Map<string, Buffer>()
  const dekRefs: Buffer[] = []
  let counter = 0

  class EncryptCommand {
    readonly __cmd = "enc" as const
    constructor(readonly input: Record<string, unknown>) {}
  }
  class DecryptCommand {
    readonly __cmd = "dec" as const
    constructor(readonly input: Record<string, unknown>) {}
  }
  class KMSClient {
    constructor(_config: { region?: string }) {}
    async send(command: unknown): Promise<Record<string, unknown>> {
      const cmd = command as { __cmd: "enc" | "dec"; input: Record<string, unknown> }
      if (cmd.__cmd === "enc") {
        const dek = cmd.input.Plaintext as Buffer
        dekRefs.push(dek) // reference to the caller's DEK, for zeroing checks
        const id = `arn:aws:kms:fake:key/${String(cmd.input.KeyId)}#${++counter}`
        blobs.set(id, Buffer.from(dek)) // KMS-side snapshot
        return { CiphertextBlob: Buffer.from(id, "utf8"), KeyId: cmd.input.KeyId as string }
      }
      const id = Buffer.from(cmd.input.CiphertextBlob as Uint8Array).toString("utf8")
      const snapshot = blobs.get(id)
      if (!snapshot) throw new Error("unknown ciphertext blob")
      return { Plaintext: Buffer.from(snapshot) }
    }
  }

  const sdk = { KMSClient, EncryptCommand, DecryptCommand } as unknown as AwsKmsSdk
  return { sdk, dekRefs }
}

const vaultWith = (keyId = "alias/primary") => {
  const fake = makeFakeAws()
  const vault = createAwsKmsVault({ keyId, region: "us-east-1", loadSdk: async () => fake.sdk })
  return { vault, fake }
}

describe("aws vault — SDK detection", () => {
  it("throws a clear 'SDK not installed' error at construction", () => {
    // @aws-sdk/client-kms is intentionally absent from this workspace.
    expect(() => createAwsKmsVault({ keyId: "alias/x" })).toThrow(/client-kms/)
  })

  it("requires a keyId", () => {
    const fake = makeFakeAws()
    expect(() => createAwsKmsVault({ keyId: "", loadSdk: async () => fake.sdk })).toThrow(/keyId/)
  })
})

describe("aws vault — envelope behaviour via fake KMS", () => {
  it("seal -> withKey round-trips the exact plaintext", async () => {
    const { vault } = vaultWith()
    const sealed = await vault.seal(PLAINTEXT, AAD)
    expect(sealed.kmsKeyId).toContain("alias/primary")
    expect(await capturedKey(vault, sealed, AAD)).toBe(PLAINTEXT)
  })

  it("decrypting with the wrong aad fails authentication", async () => {
    const { vault } = vaultWith()
    const sealed = await vault.seal(PLAINTEXT, AAD)
    await expect(vault.withKey(sealed, "va_hl_9999", async () => "never")).rejects.toThrow(VaultAuthError)
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

  it("zeroes the DEK immediately after the KMS wraps it", async () => {
    const { vault, fake } = vaultWith()
    await vault.seal(PLAINTEXT, AAD)
    expect(fake.dekRefs.length).toBe(1)
    expect(fake.dekRefs[0]?.every((byte) => byte === 0)).toBe(true)
  })

  it("withKey can be called repeatedly (each decrypt yields a fresh DEK)", async () => {
    const { vault } = vaultWith()
    const sealed = await vault.seal(PLAINTEXT, AAD)
    expect(await capturedKey(vault, sealed, AAD)).toBe(PLAINTEXT)
    expect(await capturedKey(vault, sealed, AAD)).toBe(PLAINTEXT)
  })

  it("refuses to hand the plaintext key back", async () => {
    const { vault } = vaultWith()
    const sealed = await vault.seal(PLAINTEXT, AAD)
    await expect(vault.withKey(sealed, AAD, async (key) => revealSignerKey(key))).rejects.toThrow(
      /must not return the plaintext key/,
    )
  })

  it("rewraps the DEK under a new key id without touching ciphertext", async () => {
    const { vault } = vaultWith()
    const sealed = await vault.seal(PLAINTEXT, AAD)
    const rewrapped = await vault.rewrap(sealed, "alias/rotated")
    expect(rewrapped.kmsKeyId).toContain("alias/rotated")
    expect(rewrapped.ciphertext).toBe(sealed.ciphertext)
    expect(rewrapped.wrappedDek).not.toBe(sealed.wrappedDek)
    expect(await capturedKey(vault, rewrapped, AAD)).toBe(PLAINTEXT)
  })
})
