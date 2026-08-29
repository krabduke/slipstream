/**
 * W8 — AWS KMS KeyVault backend (docs/04 §3).
 *
 * The DEK is wrapped by an AWS KMS CMK via `Encrypt`/`Decrypt`. The
 * `@aws-sdk/client-kms` SDK is intentionally NOT a hard dependency of this
 * package (minimal supply-chain surface for the custody code, docs/04 §4): the
 * backend checks for it at construction and throws a clear "SDK not installed"
 * error if it is absent, loading it with a dynamic `import()` only when present.
 *
 * `loadSdk` is injectable so the wrapping logic is testable with a fake client
 * without shipping the real SDK.
 */
import { createRequire } from "node:module"
import {
  VaultAuthError,
  encryptEnvelope,
  generateDek,
  runWithKey,
  zeroBuffer,
} from "./crypto.js"
import type { KeyVault, SealedKey } from "./types.js"
import type { SignerKey } from "@slipstream/shared/secret.js"

const SDK_SPECIFIER = "@aws-sdk/client-kms"
const AAD_CONTEXT_KEY = "venue_account_id"

interface AwsKmsClient {
  send(command: unknown): Promise<Record<string, unknown>>
  destroy?(): void
}

/** The slice of `@aws-sdk/client-kms` this backend uses. */
export interface AwsKmsSdk {
  KMSClient: new (config: { region?: string }) => AwsKmsClient
  EncryptCommand: new (input: Record<string, unknown>) => unknown
  DecryptCommand: new (input: Record<string, unknown>) => unknown
}

export interface AwsKmsVaultOptions {
  /** CMK id / alias / ARN used to wrap DEKs. */
  readonly keyId: string
  readonly region?: string
  /** Override SDK loading. Present in tests and for custom packaging. */
  readonly loadSdk?: () => Promise<AwsKmsSdk>
}

const nodeRequire = createRequire(import.meta.url)

const assertInstalled = (): void => {
  try {
    nodeRequire.resolve(SDK_SPECIFIER)
  } catch {
    throw new Error(
      `AWS KeyVault requires the optional dependency ${SDK_SPECIFIER}. ` +
        `Install it (pnpm add ${SDK_SPECIFIER}) or set KMS_PROVIDER=local.`,
    )
  }
}

const toBuffer = (value: unknown): Buffer => {
  if (Buffer.isBuffer(value)) return value
  if (typeof value === "string") return Buffer.from(value, "base64")
  if (value instanceof Uint8Array) return Buffer.from(value)
  throw new VaultAuthError("KMS returned an unreadable blob")
}

export const createAwsKmsVault = (options: AwsKmsVaultOptions): KeyVault => {
  const { keyId, region } = options
  if (!keyId) throw new Error("AWS KeyVault requires a keyId")
  // Fail at construction, not on first seal: a process should not boot into a
  // vault it cannot use. Skipped when an SDK loader is injected (tests).
  if (!options.loadSdk) assertInstalled()

  const loadSdk = options.loadSdk ?? (async (): Promise<AwsKmsSdk> => {
    // Non-literal specifier: keeps the absent optional dependency out of the
    // type graph while still resolving at runtime when installed.
    const specifier = SDK_SPECIFIER
    return (await import(specifier)) as unknown as AwsKmsSdk
  })

  let clientPromise: Promise<AwsKmsClient> | null = null
  const client = async (): Promise<{ sdk: AwsKmsSdk; kms: AwsKmsClient }> => {
    const sdk = await loadSdk()
    clientPromise ??= Promise.resolve(new sdk.KMSClient({ region }))
    return { sdk, kms: await clientPromise }
  }

  const send = async (
    kms: AwsKmsClient,
    command: unknown,
    op: "encrypt" | "decrypt",
  ): Promise<Record<string, unknown>> => {
    try {
      return await kms.send(command)
    } catch (error) {
      // Surface only the error class — never payload or key material.
      const name = error instanceof Error ? error.name : "UnknownError"
      throw new VaultAuthError(`AWS KMS ${op} failed: ${name}`)
    }
  }

  return {
    async seal(plaintext: string, aad: string): Promise<SealedKey> {
      const { sdk, kms } = await client()
      const dek = generateDek()
      try {
        const envelope = encryptEnvelope(dek, plaintext, aad)
        const res = await send(
          kms,
          new sdk.EncryptCommand({
            KeyId: keyId,
            Plaintext: dek,
            EncryptionContext: { [AAD_CONTEXT_KEY]: aad },
          }),
          "encrypt",
        )
        const blob = res.CiphertextBlob
        if (!blob) throw new VaultAuthError("AWS KMS encrypt returned no CiphertextBlob")
        return {
          ...envelope,
          wrappedDek: toBuffer(blob).toString("base64"),
          kmsKeyId: typeof res.KeyId === "string" ? res.KeyId : keyId,
          aad,
        }
      } finally {
        zeroBuffer(dek)
      }
    },

    async withKey<T>(sealed: SealedKey, aad: string, use: (key: SignerKey) => Promise<T>): Promise<T> {
      const { sdk, kms } = await client()
      const res = await send(
        kms,
        new sdk.DecryptCommand({
          CiphertextBlob: Buffer.from(sealed.wrappedDek, "base64"),
          EncryptionContext: { [AAD_CONTEXT_KEY]: aad },
        }),
        "decrypt",
      )
      const plaintext = res.Plaintext
      if (!plaintext) throw new VaultAuthError("AWS KMS decrypt returned no plaintext DEK")
      const dek = toBuffer(plaintext)
      return runWithKey(dek, sealed, aad, use)
    },

    async rewrap(sealed: SealedKey, newKmsKeyId: string): Promise<SealedKey> {
      if (newKmsKeyId === sealed.kmsKeyId) return sealed
      const { sdk, kms } = await client()
      const dec = await send(
        kms,
        new sdk.DecryptCommand({
          CiphertextBlob: Buffer.from(sealed.wrappedDek, "base64"),
          EncryptionContext: { [AAD_CONTEXT_KEY]: sealed.aad },
        }),
        "decrypt",
      )
      if (!dec.Plaintext) throw new VaultAuthError("AWS KMS decrypt returned no plaintext DEK")
      const dek = toBuffer(dec.Plaintext)
      try {
        const enc = await send(
          kms,
          new sdk.EncryptCommand({
            KeyId: newKmsKeyId,
            Plaintext: dek,
            EncryptionContext: { [AAD_CONTEXT_KEY]: sealed.aad },
          }),
          "encrypt",
        )
        const blob = enc.CiphertextBlob
        if (!blob) throw new VaultAuthError("AWS KMS encrypt returned no CiphertextBlob")
        return {
          ...sealed,
          wrappedDek: toBuffer(blob).toString("base64"),
          kmsKeyId: typeof enc.KeyId === "string" ? enc.KeyId : newKmsKeyId,
        }
      } finally {
        zeroBuffer(dek)
      }
    },
  }
}
