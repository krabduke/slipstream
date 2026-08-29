/**
 * Envelope-encrypted key material.
 *
 * `encrypted_keys` has no `user_id` column; it hangs off `venue_accounts`.
 * Every helper here therefore either joins through `venue_accounts` on the
 * caller's `userId` or proves ownership first via
 * {@link requireOwnedVenueAccount}. There is no path to a row that skips it.
 */
import { and, eq, sql } from "drizzle-orm"

import type { UserId, VenueAccountId } from "@slipstream/shared"

import type { Db } from "../client.js"
import { encryptedKeys, venueAccounts } from "../schema.js"

import { requireOwnedVenueAccount } from "./venue-accounts.js"
import { requireRow } from "./types.js"

export type EncryptedKeyRow = typeof encryptedKeys.$inferSelect

/** Ciphertext and wrapping metadata. No plaintext field exists, by design. */
export interface KeyMaterial {
  readonly ciphertext: string
  readonly iv: string
  readonly tag: string
  readonly wrappedDek: string
  readonly kmsKeyId: string
}

export const getEncryptedKey = async (
  userId: UserId,
  db: Db,
  venueAccountId: VenueAccountId,
): Promise<EncryptedKeyRow | undefined> => {
  const [row] = await db
    .select({ key: encryptedKeys })
    .from(encryptedKeys)
    .innerJoin(venueAccounts, eq(venueAccounts.id, encryptedKeys.venueAccountId))
    .where(
      and(
        eq(encryptedKeys.venueAccountId, venueAccountId),
        eq(venueAccounts.userId, userId),
      ),
    )
    .limit(1)
  return row?.key
}

/**
 * Store or replace the material for one venue account.
 *
 * `encrypted_keys_account_idx` is unique on `venue_account_id`, so this is an
 * upsert: one account holds exactly one key. On replacement `rotated_at` is
 * stamped from the database clock, which is what the audit trail reads.
 *
 * @throws TenantScopeError if the venue account is not the caller's
 */
export const upsertEncryptedKey = async (
  userId: UserId,
  db: Db,
  venueAccountId: VenueAccountId,
  material: KeyMaterial,
): Promise<EncryptedKeyRow> => {
  await requireOwnedVenueAccount(userId, db, venueAccountId)
  const [row] = await db
    .insert(encryptedKeys)
    .values({ venueAccountId, ...material })
    .onConflictDoUpdate({
      target: encryptedKeys.venueAccountId,
      set: { ...material, rotatedAt: sql`now()` },
    })
    .returning()
  return requireRow(row, "encrypted_keys upsert")
}

/**
 * Revoke the stored material. Returns whether a row was removed, so a caller
 * can tell "revoked" from "there was nothing to revoke" without a second read.
 *
 * @throws TenantScopeError if the venue account is not the caller's
 */
export const deleteEncryptedKey = async (
  userId: UserId,
  db: Db,
  venueAccountId: VenueAccountId,
): Promise<boolean> => {
  await requireOwnedVenueAccount(userId, db, venueAccountId)
  const removed = await db
    .delete(encryptedKeys)
    .where(eq(encryptedKeys.venueAccountId, venueAccountId))
    .returning({ id: encryptedKeys.id })
  return removed.length > 0
}
