/**
 * Leaders, their fills, and their computed stats.
 *
 * READ THIS BEFORE COPYING THE SHAPE OF THESE FUNCTIONS.
 *
 * These three tables are the public leaderboard: `leaders`, `leader_fills` and
 * `leader_stats` have no `user_id` column and no tenant dimension at all. They
 * describe wallets being watched on a public chain, are identical for every
 * viewer, and are written by the tracker rather than by a user. The helpers
 * here therefore take `db` first and no `userId` — there is no user to scope
 * to.
 *
 * Everything that *does* belong to a user takes `userId` as its first
 * parameter, in the other modules of this directory. No helper here reads or
 * writes a user-owned table, so this file is not a way around that rule.
 *
 * `leader_fills_venue_fill_idx` is UNIQUE on `venue_fill_id`, and
 * {@link insertLeaderFills} is built on it: a reconnect snapshot replaying 200
 * fills inserts nothing and reports nothing new.
 */
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm"

import type { Address, LeaderId, VenueFillId, VenueId } from "@slipstream/shared"

import type { Db } from "../client.js"
import { leaderFills, leaderStats, leaders } from "../schema.js"

import {
  pageLimit,
  pageOffset,
  requireRow,
  type MoneyString,
  type PageOptions,
  type TimeRange,
} from "./types.js"

export type LeaderRow = typeof leaders.$inferSelect
export type LeaderFillRow = typeof leaderFills.$inferSelect
export type LeaderStatsRow = typeof leaderStats.$inferSelect

export interface NewLeader {
  readonly venue: VenueId
  /** Stored lowercase. */
  readonly address: string
  readonly label?: string | null
}

export interface NewLeaderFill {
  readonly leaderId: LeaderId
  readonly venueMarketId: string
  readonly side: string
  readonly price: MoneyString
  readonly size: MoneyString
  readonly fee: MoneyString
  readonly closedPnl: MoneyString | null
  readonly ts: Date
  readonly venueFillId: VenueFillId
}

export interface NewLeaderStats {
  readonly leaderId: LeaderId
  /** e.g. "7d", "30d", "all". */
  readonly window: string
  readonly pnl: MoneyString
  readonly roi: MoneyString
  readonly winRate: MoneyString
  readonly maxDrawdown: MoneyString
  readonly avgHoldSecs: number
  readonly tradeCount: number
}

/**
 * Register a leader, or return the existing row for that `(venue, address)`.
 *
 * A supplied `label` overwrites; an omitted one leaves whatever label is
 * already there, so re-indexing a leader cannot wipe a name a user gave it.
 */
export const upsertLeader = async (db: Db, input: NewLeader): Promise<LeaderRow> => {
  const label = input.label ?? null
  const [row] = await db
    .insert(leaders)
    .values({ venue: input.venue, address: input.address.toLowerCase(), label })
    .onConflictDoUpdate({
      target: [leaders.venue, leaders.address],
      set: { label: sql`coalesce(excluded."label", ${leaders.label})` },
    })
    .returning()
  return requireRow(row, "leaders upsert")
}

export const getLeader = async (db: Db, leaderId: LeaderId): Promise<LeaderRow | undefined> => {
  const [row] = await db.select().from(leaders).where(eq(leaders.id, leaderId)).limit(1)
  return row
}

export const findLeader = async (
  db: Db,
  venue: VenueId,
  address: Address | string,
): Promise<LeaderRow | undefined> => {
  const [row] = await db
    .select()
    .from(leaders)
    .where(and(eq(leaders.venue, venue), eq(leaders.address, address.toLowerCase())))
    .limit(1)
  return row
}

/** The leaderboard: most recently active first. */
export const listLeaders = async (
  db: Db,
  options: PageOptions & { readonly venue?: VenueId } = {},
): Promise<LeaderRow[]> => {
  const where = options.venue === undefined ? undefined : eq(leaders.venue, options.venue)
  return db
    .select()
    .from(leaders)
    .where(where)
    .orderBy(sql`${leaders.lastEventAt} desc nulls last`)
    .limit(pageLimit(options.limit))
    .offset(pageOffset(options.offset))
}

export const setLeaderLastEventAt = async (
  db: Db,
  leaderId: LeaderId,
  at: Date,
): Promise<void> => {
  await db.update(leaders).set({ lastEventAt: at }).where(eq(leaders.id, leaderId))
}

/**
 * Insert leader fills idempotently.
 *
 * @returns only the rows this call actually inserted, so the tracker can tell
 *   a genuinely new fill from a replayed one without a second query. An empty
 *   array means the whole batch was already known.
 */
export const insertLeaderFills = async (
  db: Db,
  rows: readonly NewLeaderFill[],
): Promise<LeaderFillRow[]> => {
  if (rows.length === 0) return []
  return db
    .insert(leaderFills)
    .values(
      rows.map((row) => ({
        leaderId: row.leaderId,
        venueMarketId: row.venueMarketId,
        side: row.side,
        price: row.price,
        size: row.size,
        fee: row.fee,
        closedPnl: row.closedPnl,
        ts: row.ts,
        venueFillId: row.venueFillId,
      })),
    )
    .onConflictDoNothing({ target: leaderFills.venueFillId })
    .returning()
}

/** Newest first by default; uses `leader_fills_leader_ts_idx`. */
export const listLeaderFills = async (
  db: Db,
  leaderId: LeaderId,
  options: PageOptions & TimeRange & { readonly order?: "asc" | "desc" } = {},
): Promise<LeaderFillRow[]> => {
  const predicates: SQL[] = [eq(leaderFills.leaderId, leaderId)]
  if (options.since !== undefined) predicates.push(gte(leaderFills.ts, options.since))
  if (options.until !== undefined) predicates.push(lte(leaderFills.ts, options.until))

  return db
    .select()
    .from(leaderFills)
    .where(and(...predicates))
    .orderBy(options.order === "asc" ? asc(leaderFills.ts) : desc(leaderFills.ts))
    .limit(pageLimit(options.limit))
    .offset(pageOffset(options.offset))
}

export const findLeaderFillByVenueFillId = async (
  db: Db,
  venueFillId: VenueFillId,
): Promise<LeaderFillRow | undefined> => {
  const [row] = await db
    .select()
    .from(leaderFills)
    .where(eq(leaderFills.venueFillId, venueFillId))
    .limit(1)
  return row
}

/**
 * Replace computed stats. `leader_stats_pk` is unique on
 * `(leader_id, window)`, so recomputing a window overwrites in place.
 */
export const upsertLeaderStats = async (
  db: Db,
  rows: readonly NewLeaderStats[],
): Promise<LeaderStatsRow[]> => {
  const out: LeaderStatsRow[] = []
  for (const row of rows) {
    const [written] = await db
      .insert(leaderStats)
      .values({ ...row, computedAt: sql`now()` })
      .onConflictDoUpdate({
        target: [leaderStats.leaderId, leaderStats.window],
        set: {
          pnl: row.pnl,
          roi: row.roi,
          winRate: row.winRate,
          maxDrawdown: row.maxDrawdown,
          avgHoldSecs: row.avgHoldSecs,
          tradeCount: row.tradeCount,
          computedAt: sql`now()`,
        },
      })
      .returning()
    out.push(requireRow(written, "leader_stats upsert"))
  }
  return out
}

export const listLeaderStats = async (
  db: Db,
  leaderId: LeaderId,
): Promise<LeaderStatsRow[]> =>
  db.select().from(leaderStats).where(eq(leaderStats.leaderId, leaderId))

export const getLeaderStats = async (
  db: Db,
  leaderId: LeaderId,
  window: string,
): Promise<LeaderStatsRow | undefined> => {
  const [row] = await db
    .select()
    .from(leaderStats)
    .where(and(eq(leaderStats.leaderId, leaderId), eq(leaderStats.window, window)))
    .limit(1)
  return row
}
