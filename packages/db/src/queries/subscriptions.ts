import { and, desc, eq } from "drizzle-orm"

import type {
  LeaderId,
  SizingMode,
  SubscriptionId,
  UserId,
  VenueAccountId,
} from "@slipstream/shared"

import type { Db } from "../client.js"
import { subscriptions } from "../schema.js"

import { TenantScopeError } from "./errors.js"
import { pageLimit, pageOffset, requireRow, type MoneyString, type PageOptions } from "./types.js"

export type SubscriptionRow = typeof subscriptions.$inferSelect

/**
 * A new follow.
 *
 * `isPaper` is absent on purpose. `subscriptions.is_paper` defaults to true in
 * the database and going live is a step-up action with its own signature — so
 * the only way to flip it is {@link setSubscriptionPaperMode}, never a field
 * that rides along with something else. See docs/04 §5.
 */
export interface NewSubscription {
  readonly leaderId: LeaderId
  readonly venueAccountId: VenueAccountId
  readonly sizingMode: SizingMode["mode"]
  /** `numeric(38,18)` — the multiplier, notional or percent for the mode. */
  readonly sizingParam: MoneyString
  readonly marketFilter: unknown
}

/**
 * The editable surface of a subscription.
 *
 * Neither `isPaper` nor `status` is reachable from here: both have their own
 * named helper so that a routine settings save cannot move a follow into live
 * trading or silently resurrect a cancelled one.
 */
export interface SubscriptionPatch {
  readonly sizingMode?: SizingMode["mode"]
  readonly sizingParam?: MoneyString
  readonly marketFilter?: unknown
}

export const listSubscriptions = async (
  userId: UserId,
  db: Db,
  options: PageOptions & { readonly status?: string } = {},
): Promise<SubscriptionRow[]> => {
  const where =
    options.status === undefined
      ? eq(subscriptions.userId, userId)
      : and(eq(subscriptions.userId, userId), eq(subscriptions.status, options.status))
  return db
    .select()
    .from(subscriptions)
    .where(where)
    .orderBy(desc(subscriptions.createdAt))
    .limit(pageLimit(options.limit))
    .offset(pageOffset(options.offset))
}

export const getSubscription = async (
  userId: UserId,
  db: Db,
  subscriptionId: SubscriptionId,
): Promise<SubscriptionRow | undefined> => {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
    .limit(1)
  return row
}

/** Create a follow. It starts in paper mode; see {@link NewSubscription}. */
export const insertSubscription = async (
  userId: UserId,
  db: Db,
  input: NewSubscription,
): Promise<SubscriptionRow> => {
  const [row] = await db
    .insert(subscriptions)
    .values({
      userId,
      leaderId: input.leaderId,
      venueAccountId: input.venueAccountId,
      sizingMode: input.sizingMode,
      sizingParam: input.sizingParam,
      marketFilter: input.marketFilter,
    })
    .returning()
  return requireRow(row, "subscriptions insert")
}

/**
 * Edit sizing and market filter. Cannot touch `is_paper` or `status` — see
 * {@link SubscriptionPatch}.
 *
 * @throws TenantScopeError if the subscription is not the caller's
 */
export const updateSubscription = async (
  userId: UserId,
  db: Db,
  subscriptionId: SubscriptionId,
  patch: SubscriptionPatch,
): Promise<SubscriptionRow> => {
  const set: Partial<typeof subscriptions.$inferInsert> = {}
  if (patch.sizingMode !== undefined) set.sizingMode = patch.sizingMode
  if (patch.sizingParam !== undefined) set.sizingParam = patch.sizingParam
  if (patch.marketFilter !== undefined) set.marketFilter = patch.marketFilter
  if (Object.keys(set).length === 0) {
    const existing = await getSubscription(userId, db, subscriptionId)
    if (existing === undefined) {
      throw new TenantScopeError("subscriptions", subscriptionId, userId)
    }
    return existing
  }
  const [row] = await db
    .update(subscriptions)
    .set(set)
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
    .returning()
  if (row === undefined) {
    throw new TenantScopeError("subscriptions", subscriptionId, userId)
  }
  return row
}

/**
 * Pause, resume or cancel a follow. Writes `status` only — pausing a
 * subscription must never disturb whether it is trading real money.
 *
 * @throws TenantScopeError if the subscription is not the caller's
 */
export const setSubscriptionStatus = async (
  userId: UserId,
  db: Db,
  subscriptionId: SubscriptionId,
  status: string,
): Promise<SubscriptionRow> => {
  const [row] = await db
    .update(subscriptions)
    .set({ status })
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
    .returning()
  if (row === undefined) {
    throw new TenantScopeError("subscriptions", subscriptionId, userId)
  }
  return row
}

/**
 * The ONLY writer of `subscriptions.is_paper` after creation.
 *
 * Deliberately does nothing else, and is deliberately not reachable from
 * {@link updateSubscription}: moving a follow from paper to live is a step-up
 * action that requires a fresh signature at the call site, never a side effect
 * of saving some other setting. See docs/04 §5.
 *
 * @throws TenantScopeError if the subscription is not the caller's
 */
export const setSubscriptionPaperMode = async (
  userId: UserId,
  db: Db,
  subscriptionId: SubscriptionId,
  isPaper: boolean,
): Promise<SubscriptionRow> => {
  const [row] = await db
    .update(subscriptions)
    .set({ isPaper })
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
    .returning()
  if (row === undefined) {
    throw new TenantScopeError("subscriptions", subscriptionId, userId)
  }
  return row
}
