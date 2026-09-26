/**
 * Following a trader, from the user's side. Every helper is userId-first.
 *
 * A paper follow needs a venue account row (subscriptions reference one), but
 * there is no key and no real account behind it. Its owner is recorded as
 * `paper:<user address>` with status `paper`, so it can never collide with —
 * or be mistaken for — the user's real account on the same venue.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm"

import type { LeaderId, SizingMode, UserId, VenueAccountId } from "@slipstream/shared"

import type { Db } from "../client.js"
import { leaders, paperBooks, paperPositions, subscriptions, users } from "../schema.js"
import { upsertLeader } from "./leaders.js"
import { findVenueAccountByOwner, insertVenueAccount, setVenueAccountStatus } from "./venue-accounts.js"
import { insertSubscription } from "./subscriptions.js"

export const MAX_ACTIVE_FOLLOWS = 10

export class FollowLimitError extends Error {
  constructor() {
    super(`You can follow up to ${MAX_ACTIVE_FOLLOWS} traders at once. Stop one to add another.`)
  }
}

export async function createPaperFollow(
  userId: UserId,
  db: Db,
  input: {
    venue: "hyperliquid" | "polymarket"
    leaderAddress: string
    leaderLabel: string | null
    sizingMode: SizingMode["mode"]
    sizingParam: string
    startingEquity: string
  },
) {
  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, ["active", "paused"])))) as [{ n: number }]
  if (n >= MAX_ACTIVE_FOLLOWS) throw new FollowLimitError()

  const [user] = await db.select({ address: users.address }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new Error("user not found")
  const owner = `paper:${user.address}`
  let account = await findVenueAccountByOwner(userId, db, input.venue, owner)
  if (!account) {
    account = await insertVenueAccount(userId, db, {
      venue: input.venue,
      ownerAddress: owner,
      signerAddress: "paper",
      delegationMethod: "paper account: no key, no venue access",
      verifiedAt: new Date(),
    })
    account = await setVenueAccountStatus(userId, db, account.id as VenueAccountId, "paper")
  }
  const leader = await upsertLeader(db, { venue: input.venue, address: input.leaderAddress, label: input.leaderLabel })
  const sub = await insertSubscription(userId, db, {
    leaderId: leader.id as LeaderId,
    venueAccountId: account.id as VenueAccountId,
    sizingMode: input.sizingMode,
    sizingParam: input.sizingParam,
    marketFilter: { type: "allow_all" },
  })
  await db.insert(paperBooks).values({ subscriptionId: sub.id, startingEquity: input.startingEquity, equity: input.startingEquity })
  return sub
}

/** The follows list for one user, with the leader and the paper book. */
export async function listFollows(userId: UserId, db: Db) {
  return db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      isPaper: subscriptions.isPaper,
      sizingMode: subscriptions.sizingMode,
      sizingParam: subscriptions.sizingParam,
      createdAt: subscriptions.createdAt,
      venue: leaders.venue,
      leaderAddress: leaders.address,
      leaderLabel: leaders.label,
      startingEquity: paperBooks.startingEquity,
      equity: paperBooks.equity,
      equityAt: paperBooks.equityAt,
      realizedPnl: paperBooks.realizedPnl,
      feesPaid: paperBooks.feesPaid,
    })
    .from(subscriptions)
    .innerJoin(leaders, eq(leaders.id, subscriptions.leaderId))
    .leftJoin(paperBooks, eq(paperBooks.subscriptionId, subscriptions.id))
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, ["active", "paused"])))
    .orderBy(desc(subscriptions.createdAt))
}

export async function listFollowPositions(userId: UserId, db: Db, subscriptionIds: readonly string[]) {
  if (!subscriptionIds.length) return []
  return db
    .select({
      subscriptionId: paperPositions.subscriptionId,
      marketId: paperPositions.marketId,
      label: paperPositions.label,
      side: paperPositions.side,
      size: paperPositions.size,
      entryPrice: paperPositions.entryPrice,
    })
    .from(paperPositions)
    .innerJoin(subscriptions, eq(subscriptions.id, paperPositions.subscriptionId))
    .where(and(eq(subscriptions.userId, userId), inArray(paperPositions.subscriptionId, [...subscriptionIds])))
}

