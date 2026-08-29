/**
 * W8 — GCP Cloud KMS KeyVault backend (docs/04 §3).
 *
 * The DEK is wrapped by a GCP KMS CryptoKeyVersion via
 * `cryptoKeyEncrypt`/`cryptoKeyDecrypt`. Like the AWS backend, the
 * `@google-cloud/kms` SDK is NOT a hard dependency: construction throws a clear
 * "SDK not installed" error if it is absent, resolving it with a dynamic
 * `import()` only when present. `loadClient` is injectable for testing.
 *
 * GCP's symmetric `cryptoKeyEncrypt` has no first-class encryption-context, so
 * the row binding that matters — `aad = venue_account_id` — is enforced by the
 * AES-256-GCM data layer in crypto.ts; `additionalAuthenticatedData` on the wrap
 * is defence in depth only.
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

const SDK_SPECIFIER = "@google-cloud/kms"

interface GcpEncryptRequest {
  name: string
  plaintext: Uint8Array
  additionalAuthenticatedData?: string
}

interface GcpDecryptRequest {
  name: string
  ciphertext: Uint8Array | string
  additionalAuthenticatedData?: string
}

/** The slice of `@google-cloud/kms` this backend uses. */
export interface GcpKmsClient {
  cryptoKeyEncrypt(request: GcpEncryptRequest): Promise<[{ ciphertext?: Uint8Array | string }]>
  cryptoKeyDecrypt(request: GcpDecryptRequest): Promise<[{ plaintext?: Uint8Array | string }]>
}

export interface GcpKmsVaultOptions {
  /** Full CryptoKeyVersion resource name used to wrap DEKs. */
  readonly cryptoKeyVersion: string
  /** Override client loading. Present in tests and for custom packaging. */
  readonly loadClient?: () => Promise<GcpKmsClient>
}

const nodeRequire = createRequire(import.meta.url)

const assertInstalled = (): void => {
  try {
    nodeRequire.resolve(SDK_SPECIFIER)
  } catch {
    throw new Error(
      `GCP KeyVault requires the optional dependency ${SDK_SPECIFIER}. ` +
        `Install it (pnpm add ${SDK_SPECIFIER}) or set KMS_PROVIDER=local.`,
    )
  }
}

const toBuffer = (value: Uint8Array | string | undefined): Buffer => {
  if (value === undefined) throw new VaultAuthError("KMS returned no DEK")
  if (typeof value === "string") return Buffer.from(value, "base64")
  return Buffer.from(value)
}

export const createGcpKmsVault = (options: GcpKmsVaultOptions): KeyVault => {
  const { cryptoKeyVersion } = options
  if (!cryptoKeyVersion) throw new Error("GCP KeyVault requires a cryptoKeyVersion")
  // Fail at construction, not on first seal. Skipped when a client loader is
  // injected (tests).
  if (!options.loadClient) assertInstalled()

  const loadClient = options.loadClient ?? (async (): Promise<GcpKmsClient> => {
    const specifier = SDK_SPECIFIER
    const mod = (await import(specifier)) as { KeyManagementServiceClient: new () => GcpKmsClient }
    return new mod.KeyManagementServiceClient()
  })

  let clientPromise: Promise<GcpKmsClient> | null = null
  const client = async (): Promise<GcpKmsClient> => {
    clientPromise ??= Promise.resolve(loadClient())
    return clientPromise
  }

  const aadOf = (aad: string): string => Buffer.from(aad, "utf8").toString("base64")

  return {
    async seal(plaintext: string, aad: string): Promise<SealedKey> {
      const kms = await client()
      const dek = generateDek()
      try {
        const envelope = encryptEnvelope(dek, plaintext, aad)
        let result: { ciphertext?: Uint8Array | string }
        try {
          ;[result] = await kms.cryptoKeyEncrypt({
            name: cryptoKeyVersion,
            plaintext: dek,
            additionalAuthenticatedData: aadOf(aad),
          })
        } catch {
          throw new VaultAuthError("GCP KMS encrypt failed")
        }
        const blob = toBuffer(result.ciphertext)
        return { ...envelope, wrappedDek: blob.toString("base64"), kmsKeyId: cryptoKeyVersion, aad }
      } finally {
        zeroBuffer(dek)
      }
    },

    async withKey<T>(sealed: SealedKey, aad: string, use: (key: SignerKey) => Promise<T>): Promise<T> {
      const kms = await client()
      let result: { plaintext?: Uint8Array | string }
      try {
        ;[result] = await kms.cryptoKeyDecrypt({
          name: sealed.kmsKeyId,
          ciphertext: Buffer.from(sealed.wrappedDek, "base64"),
          additionalAuthenticatedData: aadOf(aad),
        })
      } catch {
        throw new VaultAuthError("GCP KMS decrypt failed")
      }
      const dek = toBuffer(result.plaintext)
      return runWithKey(dek, sealed, aad, use)
    },

    async rewrap(sealed: SealedKey, newKmsKeyId: string): Promise<SealedKey> {
      if (newKmsKeyId === sealed.kmsKeyId) return sealed
      const kms = await client()
      let decrypted: { plaintext?: Uint8Array | string }
      try {
        ;[decrypted] = await kms.cryptoKeyDecrypt({
          name: sealed.kmsKeyId,
          ciphertext: Buffer.from(sealed.wrappedDek, "base64"),
          additionalAuthenticatedData: aadOf(sealed.aad),
        })
      } catch {
        throw new VaultAuthError("GCP KMS decrypt failed")
      }
      const dek = toBuffer(decrypted.plaintext)
      try {
        let encrypted: { ciphertext?: Uint8Array | string }
        try {
          ;[encrypted] = await kms.cryptoKeyEncrypt({
            name: newKmsKeyId,
            plaintext: dek,
            additionalAuthenticatedData: aadOf(sealed.aad),
          })
        } catch {
          throw new VaultAuthError("GCP KMS encrypt failed")
        }
        const blob = toBuffer(encrypted.ciphertext)
        return { ...sealed, wrappedDek: blob.toString("base64"), kmsKeyId: newKmsKeyId }
      } finally {
        zeroBuffer(dek)
      }
    },
  }
}
