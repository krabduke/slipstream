/**
 * The follower's own fills.
 *
 * `fills_venue_fill_idx` is UNIQUE on `venue_fill_id`. {@link insertFills}
 * leans on it directly: the insert is ON CONFLICT DO NOTHING and returns only
 * the rows that were actually new, so replaying a WebSocket reconnect snapshot
 * of 200 fills is a no-op that reports zero new fills rather than 200
 * duplicates or an exception.
 */
import { and, asc, desc, eq, gte, lte, type SQL } from "drizzle-orm"

import type {
  IntentId,
  MarketId,
  OrderSide,
  UserId,
  VenueFillId,
} from "@slipstream/shared"

import type { Db } from "../client.js"
import { fills } from "../schema.js"

import {
  pageLimit,
  pageOffset,
  type MoneyString,
  type PageOptions,
  type TimeRange,
} from "./types.js"

export type FillRow = typeof fills.$inferSelect

export interface NewFill {
  /** null when the fill arrived without a matching local intent. */
  readonly orderIntentId: IntentId | null
  readonly venueFillId: VenueFillId
  readonly marketId: MarketId
  readonly side: OrderSide
  readonly price: MoneyString
  readonly size: MoneyString
  readonly fee: MoneyString
  readonly ts: Date
}

/**
 * Insert fills idempotently.
 *
 * @returns only the rows this call actually inserted. An empty array means
 *   every fill in `rows` was already recorded.
 */
export const insertFills = async (
  userId: UserId,
  db: Db,
  rows: readonly NewFill[],
): Promise<FillRow[]> => {
  if (rows.length === 0) return []
  return db
    .insert(fills)
    .values(
      rows.map((row) => ({
        userId,
        orderIntentId: row.orderIntentId,
        venueFillId: row.venueFillId,
        marketId: row.marketId,
        side: row.side,
        price: row.price,
        size: row.size,
        fee: row.fee,
        ts: row.ts,
      })),
    )
    .onConflictDoNothing({ target: fills.venueFillId })
    .returning()
}

/** Newest first by default; uses `fills_user_ts_idx`. */
export const listFills = async (
  userId: UserId,
  db: Db,
  options: PageOptions &
    TimeRange & {
      readonly marketId?: MarketId
      readonly order?: "asc" | "desc"
    } = {},
): Promise<FillRow[]> => {
  const predicates: SQL[] = [eq(fills.userId, userId)]
  if (options.since !== undefined) predicates.push(gte(fills.ts, options.since))
  if (options.until !== undefined) predicates.push(lte(fills.ts, options.until))
  if (options.marketId !== undefined) predicates.push(eq(fills.marketId, options.marketId))

  return db
    .select()
    .from(fills)
    .where(and(...predicates))
    .orderBy(options.order === "asc" ? asc(fills.ts) : desc(fills.ts))
    .limit(pageLimit(options.limit))
    .offset(pageOffset(options.offset))
}

export const findFillByVenueFillId = async (
  userId: UserId,
  db: Db,
  venueFillId: VenueFillId,
): Promise<FillRow | undefined> => {
  const [row] = await db
    .select()
    .from(fills)
    .where(and(eq(fills.venueFillId, venueFillId), eq(fills.userId, userId)))
    .limit(1)
  return row
}

/** The fills produced by one intent, oldest first. */
export const listFillsForIntent = async (
  userId: UserId,
  db: Db,
  orderIntentId: IntentId,
  options: PageOptions = {},
): Promise<FillRow[]> =>
  db
    .select()
    .from(fills)
    .where(and(eq(fills.orderIntentId, orderIntentId), eq(fills.userId, userId)))
    .orderBy(asc(fills.ts))
    .limit(pageLimit(options.limit))
    .offset(pageOffset(options.offset))
