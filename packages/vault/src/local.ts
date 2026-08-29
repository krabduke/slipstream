/**
 * W8 — local-file KeyVault backend (docs/04 §3). For self-hosters who run
 * Slipstream without a cloud account.
 *
 * The DEK is wrapped with a master key read from the environment instead of a
 * KMS. This is *not* equivalent to AWS/GCP KMS: there is no hardware boundary,
 * no access policy, no decrypt-rate alarm, and the master key sits in a
 * process's environment. That is exactly why `local` is opt-in via
 * `KMS_PROVIDER=local` and never a silent fallback, and why this constructor
 * warns loudly.
 *
 * The master key is never generated. A silently generated key makes yesterday's
 * ciphertext unreadable after a restart, so a missing env var is a hard error.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto"
import { createLogger, type Logger } from "@slipstream/shared/log/index.js"
import { VaultAuthError, encryptEnvelope, generateDek, runWithKey, zeroBuffer } from "./crypto.js"
import type { KeyVault, SealedKey } from "./types.js"
import type { SignerKey } from "@slipstream/shared/secret.js"

const MASTER_KEY_ENV = "LOCAL_MASTER_KEY"
const KEY_ID_ENV = "KMS_KEY_ID"
const DEFAULT_KEY_ID = "local-master"
/** Fixed domain-separator salt for the passphrase derivation path only; the
 *  wrapping itself uses a random IV. Changing it breaks existing ciphertext. */
const CONTEXT_SALT = "slipstream/local-vault/master-key/v1"
const WRAP_IV_BYTES = 12
const WRAP_TAG_BYTES = 16
const DEK_BYTES = 32
const HEX64 = /^[0-9a-fA-F]{64}$/

export interface LocalFileVaultOptions {
  /** Master key material. Falls back to `$LOCAL_MASTER_KEY`. Must be 64-hex,
   *  base64(32 bytes), or a >=32-char high-entropy passphrase. */
  readonly masterKey?: string
  /** Identifier recorded as `kmsKeyId`. Falls back to `$KMS_KEY_ID`. */
  readonly keyId?: string
  /** Extra keys available as rotation targets for `rewrap`, keyed by id. */
  readonly additionalKeys?: Readonly<Record<string, string>>
  /** Injectable environment, defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Logger for the startup warning; defaults to a stdout logger. */
  readonly logger?: Logger
}

/** Derive a 32-byte master key from the configured secret. Deterministic across
 *  restarts so stored ciphertext stays readable. */
const deriveMasterKey = (secret: string): Buffer => {
  if (HEX64.test(secret)) return Buffer.from(secret, "hex")
  if (secret.length % 4 === 0) {
    const decoded = Buffer.from(secret, "base64")
    if (decoded.length === DEK_BYTES && decoded.toString("base64") === secret) return decoded
  }
  if (secret.length < 32) {
    throw new Error(`${MASTER_KEY_ENV} must be 64-hex, base64(32 bytes), or at least 32 characters`)
  }
  return scryptSync(secret, CONTEXT_SALT, DEK_BYTES)
}

const wrapDek = (master: Buffer, keyId: string, dek: Buffer): string => {
  const iv = randomBytes(WRAP_IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", master, iv, { authTagLength: WRAP_TAG_BYTES })
  // Bind the wrapped blob to the key that produced it so a `kmsKeyId` swap is
  // caught at unwrap rather than silently trying the wrong master.
  cipher.setAAD(Buffer.from(keyId, "utf8"))
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()])
  return [iv, ciphertext, cipher.getAuthTag()].map((b) => b.toString("base64")).join(":")
}

const unwrapDek = (master: Buffer, keyId: string, wrapped: string): Buffer => {
  const parts = wrapped.split(":")
  if (parts.length !== 3) throw new VaultAuthError("wrapped DEK is malformed")
  const [ivB64, ctB64, tagB64] = parts
  if (!ivB64 || !ctB64 || !tagB64) throw new VaultAuthError("wrapped DEK is malformed")
  const iv = Buffer.from(ivB64, "base64")
  const ciphertext = Buffer.from(ctB64, "base64")
  const tag = Buffer.from(tagB64, "base64")
  const decipher = createDecipheriv("aes-256-gcm", master, iv, { authTagLength: WRAP_TAG_BYTES })
  decipher.setAAD(Buffer.from(keyId, "utf8"))
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new VaultAuthError("wrapped DEK failed authentication for the current master key")
  }
}

export const createLocalFileVault = (options: LocalFileVaultOptions = {}): KeyVault => {
  const env = options.env ?? process.env
  const logger = options.logger ?? createLogger({ level: "info" })

  const secret = options.masterKey ?? env[MASTER_KEY_ENV]
  if (!secret || secret.trim() === "") {
    throw new Error(
      `local KeyVault requires ${MASTER_KEY_ENV}; refusing to start with a generated master key ` +
        `(a fresh key every boot makes all existing ciphertext unreadable)`,
    )
  }

  const activeKeyId = options.keyId ?? env[KEY_ID_ENV] ?? DEFAULT_KEY_ID
  const masterByKeyId = new Map<string, Buffer>()
  masterByKeyId.set(activeKeyId, deriveMasterKey(secret))
  for (const [id, material] of Object.entries(options.additionalKeys ?? {})) {
    masterByKeyId.set(id, deriveMasterKey(material))
  }

  const masterFor = (keyId: string): Buffer => {
    const key = masterByKeyId.get(keyId)
    if (!key) throw new VaultAuthError(`no local master key registered for id "${keyId}"`)
    return key
  }

  logger.warn(
    "local KeyVault is not equivalent to a KMS: the master key lives in process env, " +
      "with no hardware boundary, access policy, or decrypt-rate alarm. Use aws/gcp for custody of real funds.",
    { component: "vault", backend: "local", kmsKeyId: activeKeyId },
  )

  const unwrapActive = (sealed: SealedKey): Buffer => unwrapDek(masterFor(sealed.kmsKeyId), sealed.kmsKeyId, sealed.wrappedDek)

  return {
    async seal(plaintext: string, aad: string): Promise<SealedKey> {
      const dek = generateDek()
      try {
        const envelope = encryptEnvelope(dek, plaintext, aad)
        const wrappedDek = wrapDek(masterFor(activeKeyId), activeKeyId, dek)
        return { ...envelope, wrappedDek, kmsKeyId: activeKeyId, aad }
      } finally {
        zeroBuffer(dek)
      }
    },

    async withKey<T>(sealed: SealedKey, aad: string, use: (key: SignerKey) => Promise<T>): Promise<T> {
      const dek = unwrapActive(sealed)
      return runWithKey(dek, sealed, aad, use)
    },

    async rewrap(sealed: SealedKey, newKmsKeyId: string): Promise<SealedKey> {
      if (newKmsKeyId === sealed.kmsKeyId) return sealed
      const dek = unwrapActive(sealed)
      try {
        const wrappedDek = wrapDek(masterFor(newKmsKeyId), newKmsKeyId, dek)
        return { ...sealed, wrappedDek, kmsKeyId: newKmsKeyId }
      } finally {
        zeroBuffer(dek)
      }
    },
  }
}
