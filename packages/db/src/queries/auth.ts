/**
 * Sign-in: SIWE nonces and the user row a signature creates.
 *
 * These run BEFORE there is a userId — that is what signing in produces — so
 * they are the one place a user row is reached by address rather than by id.
 * Nothing here reads another user's data: the address comes from a verified
 * signature, and the helpers return only that address's own row.
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm"

import type { UserId } from "@slipstream/shared"

import type { Db } from "../client.js"
import { siweNonces, users } from "../schema.js"

export async function createNonce(db: Db, nonce: string, ttlMs = 10 * 60_000): Promise<void> {
  await db.insert(siweNonces).values({ nonce, expiresAt: new Date(Date.now() + ttlMs) })
  // Housekeeping: nonces are useless once expired; keep the table small.
  await db.delete(siweNonces).where(sql`${siweNonces.expiresAt} < now() - interval '1 day'`)
}

/** Single use: marks the nonce spent and returns true only the first time. */
export async function consumeNonce(db: Db, nonce: string, address: string): Promise<boolean> {
  const rows = await db
    .update(siweNonces)
    .set({ usedAt: new Date(), address: address.toLowerCase() })
    .where(and(eq(siweNonces.nonce, nonce), isNull(siweNonces.usedAt), gt(siweNonces.expiresAt, new Date())))
    .returning({ nonce: siweNonces.nonce })
  return rows.length === 1
}

export async function upsertUserByAddress(db: Db, address: string): Promise<{ id: UserId; address: string }> {
  const a = address.toLowerCase()
  const [row] = await db
    .insert(users)
    .values({ address: a, lastSeenAt: new Date() })
    .onConflictDoUpdate({ target: users.address, set: { lastSeenAt: new Date() } })
    .returning({ id: users.id, address: users.address })
  return { id: row!.id as UserId, address: row!.address }
}
