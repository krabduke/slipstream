/**
 * The decision ledger.
 *
 * APPEND-ONLY. This module exports inserts and reads and nothing else: there
 * is no update helper and no delete helper, not even for convenience. The
 * ledger is the audit trail, the debugging tool and a user-facing feature at
 * once — a row that can be rewritten is none of those. See docs/03 §7.
 */
import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm"

import type {
  MarketId,
  ReasonCode,
  SubscriptionId,
  UserId,
  VenueId,
} from "@slipstream/shared"

import type { Db } from "../client.js"
import { decisions } from "../schema.js"

import {
  pageLimit,
  pageOffset,
  requireRow,
  type DecisionVerdict,
  type MoneyString,
  type PageOptions,
  type TimeRange,
} from "./types.js"

export type DecisionRow = typeof decisions.$inferSelect

export interface NewDecision {
  readonly subscriptionId: SubscriptionId | null
  readonly venue: VenueId
  readonly marketId: MarketId
  readonly verdict: DecisionVerdict
  /** Null only for verdicts that need no reason, e.g. a plain copy. */
  readonly reasonCode: ReasonCode | null
  /**
   * The numbers behind the decision, pre-formatted as strings so the ledger
   * never stores a float — e.g. `{ observedBps: "87", limitBps: "50" }`.
   */
  readonly detail: Readonly<Record<string, string>>
  readonly leaderAddress: string | null
  readonly leaderFillPrice: MoneyString | null
  /** Defaults to the database clock. */
  readonly ts?: Date
}

const toValues = (userId: UserId, input: NewDecision) => ({
  userId,
  subscriptionId: input.subscriptionId,
  venue: input.venue,
  marketId: input.marketId,
  verdict: input.verdict,
  reasonCode: input.reasonCode,
  detail: input.detail,
  leaderAddress: input.leaderAddress?.toLowerCase() ?? null,
  leaderFillPrice: input.leaderFillPrice,
  ...(input.ts === undefined ? {} : { ts: input.ts }),
})

export const insertDecision = async (
  userId: UserId,
  db: Db,
  input: NewDecision,
): Promise<DecisionRow> => {
  const [row] = await db.insert(decisions).values(toValues(userId, input)).returning()
  return requireRow(row, "decisions insert")
}

/** Batch form. Every row is attributed to `userId`, whatever the inputs say. */
export const insertDecisions = async (
  userId: UserId,
  db: Db,
  inputs: readonly NewDecision[],
): Promise<DecisionRow[]> => {
  if (inputs.length === 0) return []
  return db
    .insert(decisions)
    .values(inputs.map((input) => toValues(userId, input)))
    .returning()
}

/** Newest first; uses `decisions_user_ts_idx`. */
export const listDecisions = async (
  userId: UserId,
  db: Db,
  options: PageOptions &
    TimeRange & {
      readonly verdict?: DecisionVerdict
      readonly marketId?: MarketId
      readonly subscriptionId?: SubscriptionId
    } = {},
): Promise<DecisionRow[]> => {
  const predicates: SQL[] = [eq(decisions.userId, userId)]
  if (options.since !== undefined) predicates.push(gte(decisions.ts, options.since))
  if (options.until !== undefined) predicates.push(lte(decisions.ts, options.until))
  if (options.verdict !== undefined) predicates.push(eq(decisions.verdict, options.verdict))
  if (options.marketId !== undefined) predicates.push(eq(decisions.marketId, options.marketId))
  if (options.subscriptionId !== undefined) {
    predicates.push(eq(decisions.subscriptionId, options.subscriptionId))
  }

  return db
    .select()
    .from(decisions)
    .where(and(...predicates))
    .orderBy(desc(decisions.ts))
    .limit(pageLimit(options.limit))
    .offset(pageOffset(options.offset))
}
