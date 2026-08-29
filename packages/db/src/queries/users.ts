import { eq } from "drizzle-orm"

import type { UserId } from "@slipstream/shared"

import type { Db } from "../client.js"
import { users } from "../schema.js"

export type UserRow = typeof users.$inferSelect

/** The caller's own account row, or `undefined` if the id is unknown. */
export const getUser = async (userId: UserId, db: Db): Promise<UserRow | undefined> => {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  return row
}

/**
 * Record that the user was seen. Touches `last_seen_at` and nothing else.
 *
 * `address` is never written here: an account's address is fixed at creation
 * and rewriting it would silently re-key every SIWE login.
 */
export const touchUserLastSeen = async (
  userId: UserId,
  db: Db,
  at: Date = new Date(),
): Promise<void> => {
  await db.update(users).set({ lastSeenAt: at }).where(eq(users.id, userId))
}
