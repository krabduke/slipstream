/**
 * Position snapshots.
 *
 * Like `encrypted_keys`, `positions_snapshot` has no `user_id` of its own and
 * hangs off `venue_accounts`. Reads join through it on the caller's `userId`;
 * the delete scopes itself with a subquery over the caller's accounts; the
 * upsert proves ownership first, because an INSERT has nowhere to put a WHERE.
 *
 * Positions are keyed by the **funder** address on Polymarket — see
 * `findVenueAccountByFunder`, never the owner or the signer.
 */
import { and, eq, inArray } from "drizzle-orm"

import type { MarketId, UserId, VenueAccountId } from "@slipstream/shared"

import type { Db } from "../client.js"
import { positionsSnapshot, venueAccounts } from "../schema.js"

import { requireOwnedVenueAccount } from "./venue-accounts.js"
import { requireRow, type MoneyString } from "./types.js"

export type PositionSnapshotRow = typeof positionsSnapshot.$inferSelect

export interface PositionSnapshotInput {
  readonly marketId: MarketId
  readonly side: string
  readonly size: MoneyString
  readonly entryPrice: MoneyString
  readonly unrealizedPnl: MoneyString
}

/** Every venue account belonging to the caller, as a subquery. */
const ownedAccountIds = (userId: UserId, db: Db) =>
  db.select({ id: venueAccounts.id }).from(venueAccounts).where(eq(venueAccounts.userId, userId))

/** All open positions across the user's accounts, or one account's. */
export const listPositions = async (
  userId: UserId,
  db: Db,
  venueAccountId?: VenueAccountId,
): Promise<PositionSnapshotRow[]> => {
  const scope =
    venueAccountId === undefined
      ? eq(venueAccounts.userId, userId)
      : and(
          eq(venueAccounts.userId, userId),
          eq(positionsSnapshot.venueAccountId, venueAccountId),
        )
  const rows = await db
    .select({ position: positionsSnapshot })
    .from(positionsSnapshot)
    .innerJoin(venueAccounts, eq(venueAccounts.id, positionsSnapshot.venueAccountId))
    .where(scope)
  return rows.map((row) => row.position)
}

export const getPosition = async (
  userId: UserId,
  db: Db,
  venueAccountId: VenueAccountId,
  marketId: MarketId,
): Promise<PositionSnapshotRow | undefined> => {
  const [row] = await db
    .select({ position: positionsSnapshot })
    .from(positionsSnapshot)
    .innerJoin(venueAccounts, eq(venueAccounts.id, positionsSnapshot.venueAccountId))
    .where(
      and(
        eq(venueAccounts.userId, userId),
        eq(positionsSnapshot.venueAccountId, venueAccountId),
        eq(positionsSnapshot.marketId, marketId),
      ),
    )
    .limit(1)
  return row?.position
}

/**
 * Replace the snapshot for one market. `positions_snapshot_pk` is unique on
 * `(venue_account_id, market_id)`, so this is a plain upsert.
 *
 * @throws TenantScopeError if the venue account is not the caller's
 */
export const upsertPosition = async (
  userId: UserId,
  db: Db,
  venueAccountId: VenueAccountId,
  input: PositionSnapshotInput,
  ts: Date = new Date(),
): Promise<PositionSnapshotRow> => {
  await requireOwnedVenueAccount(userId, db, venueAccountId)
  const [row] = await db
    .insert(positionsSnapshot)
    .values({
      venueAccountId,
      marketId: input.marketId,
      side: input.side,
      size: input.size,
      entryPrice: input.entryPrice,
      unrealizedPnl: input.unrealizedPnl,
      ts,
    })
    .onConflictDoUpdate({
      target: [positionsSnapshot.venueAccountId, positionsSnapshot.marketId],
      set: {
        side: input.side,
        size: input.size,
        entryPrice: input.entryPrice,
        unrealizedPnl: input.unrealizedPnl,
        ts,
      },
    })
    .returning()
  return requireRow(row, "positions_snapshot upsert")
}

/**
 * Drop a market's snapshot — the position is flat.
 *
 * Scoped by a subquery over the caller's accounts rather than by a prior read,
 * so the tenant check and the delete are one statement.
 *
 * @returns whether a row was removed.
 */
export const deletePosition = async (
  userId: UserId,
  db: Db,
  venueAccountId: VenueAccountId,
  marketId: MarketId,
): Promise<boolean> => {
  const removed = await db
    .delete(positionsSnapshot)
    .where(
      and(
        eq(positionsSnapshot.venueAccountId, venueAccountId),
        eq(positionsSnapshot.marketId, marketId),
        inArray(positionsSnapshot.venueAccountId, ownedAccountIds(userId, db)),
      ),
    )
    .returning({ marketId: positionsSnapshot.marketId })
  return removed.length > 0
}
