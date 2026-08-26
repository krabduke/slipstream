/**
 * Plaintext key material.
 *
 * `SignerKey` is deliberately opaque and lives in `shared` so that both
 * `vault` (which produces it) and `venues` (which consumes it) can reference
 * the same type without a package cycle.
 *
 * Rules, enforced by review and by the log redactor:
 *  - Obtained only inside `KeyVault.withKey`, never returned from it.
 *  - Never stored, never logged, never serialised, never placed in an error
 *    message, a `cause`, a URL, or an analytics event.
 *  - Never widened back to `string` outside the venue signing functions.
 */

declare const signerKeyBrand: unique symbol

export interface SignerKey {
  readonly [signerKeyBrand]: true
}

/** The single sanctioned narrowing, used only by venue signing code.
 *  Every call site is a review checkpoint. */
export const revealSignerKey = (k: SignerKey): string => k as unknown as string

/** The single sanctioned widening, used only by KeyVault implementations. */
export const asSignerKey = (s: string): SignerKey => s as unknown as SignerKey
