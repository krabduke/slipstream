/**
 * Shared envelope-encryption logic (docs/04 §3).
 *
 * Every backend drives the same data-layer cipher so that the three
 * implementations differ only in *how the DEK is wrapped*, never in how the
 * plaintext is protected. That keeps the security-critical invariants —
 * AES-256-GCM, fresh IV per seal, and the `aad` binding the ciphertext to its
 * row — defined in exactly one place.
 *
 * Nothing here reads a key from the environment or a KMS; the backends do that
 * and hand us the DEK. This module is pure crypto and the single `withKey`
 * implementation, so the "decrypt then hand to a callback then zero" flow is
 * audited once.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { asSignerKey } from "@slipstream/shared/secret.js"
import type { SignerKey } from "@slipstream/shared/secret.js"
import type { SealedKey } from "./types.js"

const ALGORITHM = "aes-256-gcm" as const
const DEK_BYTES = 32
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

/** A fresh 256-bit data key. Generated per seal and never reused (docs/04 §3). */
export const generateDek = (): Buffer => randomBytes(DEK_BYTES)

/** Overwrite a buffer in place. Best-effort hygiene, not a security guarantee
 *  against a memory dump — JS strings handed to callers cannot be zeroed. */
export const zeroBuffer = (buffer: Buffer | null | undefined): void => {
  if (buffer) buffer.fill(0)
}

/** The AES-256-GCM body of a seal. Returns base64 pieces; the caller assembles
 *  the `SealedKey` and the wrapped DEK alongside them. */
export interface Envelope {
  readonly ciphertext: string
  readonly iv: string
  readonly tag: string
}

export const encryptEnvelope = (dek: Buffer, plaintext: string, aad: string): Envelope => {
  // Fresh IV per seal. Reusing an IV with the same key under GCM is a total
  // loss of confidentiality, so it is drawn here rather than passed in.
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, dek, iv, { authTagLength: AUTH_TAG_BYTES })
  cipher.setAAD(Buffer.from(aad, "utf8"))
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  }
}

/**
 * Decrypts to a Buffer the caller MUST zero. A wrong `aad` or a tampered
 * ciphertext makes `final()` throw rather than return plaintext, which is the
 * whole point of authenticated encryption (docs/04 §3): a swapped row fails
 * closed instead of handing back another user's key.
 */
export const decryptEnvelope = (dek: Buffer, sealed: SealedKey, aad: string): Buffer => {
  const iv = decodeBase64(sealed.iv, "iv")
  const ciphertext = decodeBase64(sealed.ciphertext, "ciphertext")
  const tag = decodeBase64(sealed.tag, "tag")
  const decipher = createDecipheriv(ALGORITHM, dek, iv, { authTagLength: AUTH_TAG_BYTES })
  decipher.setAAD(Buffer.from(aad, "utf8"))
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    // Authenticated decryption failed: wrong aad, tampered ciphertext, or
    // corrupt fields. Report the condition, never the material that caused it.
    throw new VaultAuthError("ciphertext failed authentication for the supplied aad")
  }
}

/**
 * The one decryption path shared by every backend: decrypt under the DEK, hand
 * the plaintext to `use` as a `SignerKey`, then zero the DEK — including when
 * `use` throws.
 *
 * The plaintext is never returned. A callback that tries to smuggle the key out
 * as its own return value is refused, so no caller obtains a long-lived
 * plaintext handle by returning it. (A callback could still derive a value from
 * the key; that is the sanctioned point of `withKey`, and deriving is exactly
 * what signing does.)
 */
export const runWithKey = async <T>(
  dek: Buffer,
  sealed: SealedKey,
  aad: string,
  use: (key: SignerKey) => Promise<T>,
): Promise<T> => {
  let plaintextBuffer: Buffer | null = null
  let plaintext = ""
  try {
    plaintextBuffer = decryptEnvelope(dek, sealed, aad)
    plaintext = plaintextBuffer.toString("utf8")
    const key = asSignerKey(plaintext)
    const result = await use(key)
    if (typeof result === "string" && result === plaintext) {
      throw new VaultAuthError("withKey callback must not return the plaintext key")
    }
    return result
  } finally {
    zeroBuffer(plaintextBuffer)
    zeroBuffer(dek)
    plaintext = ""
  }
}

/** Raised for authentication failures and misuse. Carries no key material. */
export class VaultAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VaultAuthError"
  }
}

const decodeBase64 = (value: string, field: string): Buffer => {
  const buffer = Buffer.from(value, "base64")
  // Buffer.from(..., "base64") is forgiving and returns a short buffer for
  // malformed input; check the round-trip so a corrupt field fails loudly here
  // rather than producing a valid-looking short IV/tag downstream.
  if (buffer.toString("base64") !== value) {
    throw new VaultAuthError(`sealed.${field} is not well-formed base64`)
  }
  return buffer
}
