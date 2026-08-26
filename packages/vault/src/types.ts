/**
 * Key vault contract.
 *
 * Envelope encryption: a per-venue-account data key (DEK) encrypts the key
 * material with AES-256-GCM; the DEK itself is wrapped by a KMS master key.
 * Database theft alone yields ciphertext and wrapped DEKs and nothing usable.
 * See docs/04 §3.
 *
 * Three implementations (W8): AWS KMS, GCP KMS, and a local-file backend for
 * self-hosters, which must warn loudly at startup that it is not equivalent.
 */
import type { SignerKey } from "@slipstream/shared/secret.js"

export interface SealedKey {
  readonly ciphertext: string
  readonly iv: string
  readonly tag: string
  readonly wrappedDek: string
  readonly kmsKeyId: string
  /** Additional authenticated data — always the `venue_account_id`. Binds the
   *  ciphertext to its row, so a swapped row fails authentication instead of
   *  decrypting to another user's key. */
  readonly aad: string
}

export interface KeyVault {
  /** Generates a fresh DEK. DEKs are never reused across accounts and are
   *  discarded immediately after use. */
  seal(plaintext: string, aad: string): Promise<SealedKey>

  /**
   * Scoped access to plaintext. The key is passed *into* `use` and is never
   * returned, so there is no way to obtain a long-lived plaintext handle.
   * This is the only decryption path.
   */
  withKey<T>(sealed: SealedKey, aad: string, use: (key: SignerKey) => Promise<T>): Promise<T>

  /** Key rotation: re-wrap the DEK under a new KMS key without touching the
   *  ciphertext. Old material is deleted, never archived. */
  rewrap(sealed: SealedKey, newKmsKeyId: string): Promise<SealedKey>
}
