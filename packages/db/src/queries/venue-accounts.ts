/**
 * Venue accounts.
 *
 * `ownerAddress`, `signerAddress` and `funderAddress` are three DIFFERENT
 * addresses and there is deliberately no helper that searches "the address"
 * across them. Lookups name the role they mean: positions are keyed by the
 * funder, orders are signed by the signer, and only the owner can withdraw.
 * See docs/02 §3 and docs/04 §1.
 */
import { and, eq } from "drizzle-orm"

import type { UserId, VenueAccountId } from "@slipstream/shared"

import type { Db } from "../client.js"
import { venueAccounts } from "../schema.js"

import { TenantScopeError } from "./errors.js"
import { requireRow } from "./types.js"

export type VenueAccountRow = typeof venueAccounts.$inferSelect

export interface NewVenueAccount {
  readonly venue: string
  /** Only this address can withdraw. Stored lowercase. */
  readonly ownerAddress: string
  /** Signs orders. Never the withdrawal authority. Stored lowercase. */
  readonly signerAddress: string
  /** Proxy/deposit wallet positions are keyed by, where the venue has one. */
  readonly funderAddress?: string | null
  /** Verbatim record of how delegation was proven, for the audit log. */
  readonly delegationMethod: string
  readonly verifiedAt: Date
}

export const listVenueAccounts = async (
  userId: UserId,
  db: Db,
): Promise<VenueAccountRow[]> =>
  db.select().from(venueAccounts).where(eq(venueAccounts.userId, userId))

export const getVenueAccount = async (
  userId: UserId,
  db: Db,
  venueAccountId: VenueAccountId,
): Promise<VenueAccountRow | undefined> => {
  const [row] = await db
    .select()
    .from(venueAccounts)
    .where(and(eq(venueAccounts.id, venueAccountId), eq(venueAccounts.userId, userId)))
    .limit(1)
  return row
}

/**
 * Resolve a venue account id, proving the caller owns it.
 *
 * Exported because the two tables with no `user_id` column of their own —
 * `encrypted_keys` and `positions_snapshot` — hang their tenant check off it,
 * and because a caller about to do several writes against one account should
 * be able to check once, explicitly.
 *
 * @throws TenantScopeError if the account is missing or belongs to someone else
 */
export const requireOwnedVenueAccount = async (
  userId: UserId,
  db: Db,
  venueAccountId: VenueAccountId,
): Promise<VenueAccountRow> => {
  const row = await getVenueAccount(userId, db, venueAccountId)
  if (row === undefined) {
    throw new TenantScopeError("venue_accounts", venueAccountId, userId)
  }
  return row
}

/** Look up by the withdrawal authority. Not the signer, not the funder. */
export const findVenueAccountByOwner = async (
  userId: UserId,
  db: Db,
  venue: string,
  ownerAddress: string,
): Promise<VenueAccountRow | undefined> => {
  const [row] = await db
    .select()
    .from(venueAccounts)
    .where(
      and(
        eq(venueAccounts.userId, userId),
        eq(venueAccounts.venue, venue),
        eq(venueAccounts.ownerAddress, ownerAddress.toLowerCase()),
      ),
    )
    .limit(1)
  return row
}

/**
 * Look up by the funder (proxy/deposit) address — the key positions are
 * reported under. Separate from {@link findVenueAccountByOwner} on purpose.
 */
export const findVenueAccountByFunder = async (
  userId: UserId,
  db: Db,
  venue: string,
  funderAddress: string,
): Promise<VenueAccountRow | undefined> => {
  const [row] = await db
    .select()
    .from(venueAccounts)
    .where(
      and(
        eq(venueAccounts.userId, userId),
        eq(venueAccounts.venue, venue),
        eq(venueAccounts.funderAddress, funderAddress.toLowerCase()),
      ),
    )
    .limit(1)
  return row
}

/**
 * Link a venue account to the calling user.
 *
 * All three addresses are lowercased here rather than at the call site;
 * `users.address` and every address column in this schema are stored
 * lowercase, and relying on callers to normalise is how a duplicate account
 * gets created for the same wallet.
 */
export const insertVenueAccount = async (
  userId: UserId,
  db: Db,
  input: NewVenueAccount,
): Promise<VenueAccountRow> => {
  const [row] = await db
    .insert(venueAccounts)
    .values({
      userId,
      venue: input.venue,
      ownerAddress: input.ownerAddress.toLowerCase(),
      signerAddress: input.signerAddress.toLowerCase(),
      funderAddress: input.funderAddress?.toLowerCase() ?? null,
      delegationMethod: input.delegationMethod,
      verifiedAt: input.verifiedAt,
    })
    .returning()
  return requireRow(row, "venue_accounts insert")
}

export const setVenueAccountStatus = async (
  userId: UserId,
  db: Db,
  venueAccountId: VenueAccountId,
  status: string,
): Promise<VenueAccountRow> => {
  const [row] = await db
    .update(venueAccounts)
    .set({ status })
    .where(and(eq(venueAccounts.id, venueAccountId), eq(venueAccounts.userId, userId)))
    .returning()
  if (row === undefined) {
    throw new TenantScopeError("venue_accounts", venueAccountId, userId)
  }
  return row
}

/**
 * Rotate the signer. `ownerAddress` and `funderAddress` are untouched — a
 * helper that could rewrite the withdrawal authority as part of a routine key
 * rotation is exactly the conflation this module refuses to allow.
 */
export const setVenueAccountSigner = async (
  userId: UserId,
  db: Db,
  venueAccountId: VenueAccountId,
  signerAddress: string,
): Promise<VenueAccountRow> => {
  const [row] = await db
    .update(venueAccounts)
    .set({ signerAddress: signerAddress.toLowerCase() })
    .where(and(eq(venueAccounts.id, venueAccountId), eq(venueAccounts.userId, userId)))
    .returning()
  if (row === undefined) {
    throw new TenantScopeError("venue_accounts", venueAccountId, userId)
  }
  return row
}
