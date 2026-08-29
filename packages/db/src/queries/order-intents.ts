/**
 * Order intents.
 *
 * `order_intents_idempotency_idx` is UNIQUE on `idempotency_key` and is what
 * makes a crash between "decided" and "placed" safe to retry.
 * {@link insertOrderIntent} is built around it: the insert is
 * ON CONFLICT DO NOTHING, and a conflict returns the *existing* row with
 * `created: false` rather than raising. A retry is therefore a no-op that
 * still hands the caller the intent it needs to reconcile.
 */
import { and, desc, eq } from "drizzle-orm"

import type {
  ExitReason,
  IdempotencyKey,
  IntentId,
  MarketId,
  OrderSide,
  SubscriptionId,
  UserId,
  VenueId,
  VenueOrderId,
} from "@slipstream/shared"

import type { Db } from "../client.js"
import { orderIntents } from "../schema.js"

import { TenantScopeError } from "./errors.js"
import {
  pageLimit,
  pageOffset,
  type IntentKind,
  type MoneyString,
  type OrderKindTag,
  type PageOptions,
} from "./types.js"

export type OrderIntentRow = typeof orderIntents.$inferSelect

export interface NewOrderIntent {
  /** null for manual trades. */
  readonly subscriptionId: SubscriptionId | null
  readonly venue: VenueId
  readonly marketId: MarketId
  readonly side: OrderSide
  readonly size: MoneyString
  /** null for market orders. */
  readonly limitPrice: MoneyString | null
  readonly kind: OrderKindTag
  /** Exits bypass the risk gate; see docs/03 §5. */
  readonly intentKind: IntentKind
  readonly exitReason: ExitReason | null
  readonly idempotencyKey: IdempotencyKey
}

/** `created: false` means the key was already recorded and this is the retry. */
export interface RecordedOrderIntent {
  readonly intent: OrderIntentRow
  readonly created: boolean
}

/**
 * Record an intent idempotently.
 *
 * @throws TenantScopeError if the idempotency key is already held by a
 *   different user. The unique index is global, so a collision across tenants
 *   is possible in principle; returning the other tenant's row would be a
 *   cross-tenant read, and returning `created: true` would be a lie.
 */
export const insertOrderIntent = async (
  userId: UserId,
  db: Db,
  input: NewOrderIntent,
): Promise<RecordedOrderIntent> => {
  const [inserted] = await db
    .insert(orderIntents)
    .values({
      userId,
      subscriptionId: input.subscriptionId,
      venue: input.venue,
      marketId: input.marketId,
      side: input.side,
      size: input.size,
      limitPrice: input.limitPrice,
      kind: input.kind,
      intentKind: input.intentKind,
      exitReason: input.exitReason,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: orderIntents.idempotencyKey })
    .returning()

  if (inserted !== undefined) return { intent: inserted, created: true }

  const existing = await findOrderIntentByIdempotencyKey(userId, db, input.idempotencyKey)
  if (existing === undefined) {
    throw new TenantScopeError("order_intents", input.idempotencyKey, userId)
  }
  return { intent: existing, created: false }
}

export const getOrderIntent = async (
  userId: UserId,
  db: Db,
  intentId: IntentId,
): Promise<OrderIntentRow | undefined> => {
  const [row] = await db
    .select()
    .from(orderIntents)
    .where(and(eq(orderIntents.id, intentId), eq(orderIntents.userId, userId)))
    .limit(1)
  return row
}

export const findOrderIntentByIdempotencyKey = async (
  userId: UserId,
  db: Db,
  idempotencyKey: IdempotencyKey,
): Promise<OrderIntentRow | undefined> => {
  const [row] = await db
    .select()
    .from(orderIntents)
    .where(
      and(
        eq(orderIntents.idempotencyKey, idempotencyKey),
        eq(orderIntents.userId, userId),
      ),
    )
    .limit(1)
  return row
}

/** Newest first. Filtering by `status` uses `order_intents_user_status_idx`. */
export const listOrderIntents = async (
  userId: UserId,
  db: Db,
  options: PageOptions & { readonly status?: string } = {},
): Promise<OrderIntentRow[]> => {
  const where =
    options.status === undefined
      ? eq(orderIntents.userId, userId)
      : and(eq(orderIntents.userId, userId), eq(orderIntents.status, options.status))
  return db
    .select()
    .from(orderIntents)
    .where(where)
    .orderBy(desc(orderIntents.createdAt))
    .limit(pageLimit(options.limit))
    .offset(pageOffset(options.offset))
}

/**
 * Advance an intent's lifecycle.
 *
 * `venueOrderId` and `rejectReason` are written only when supplied, so
 * recording a rejection cannot blank the venue id of an order that did reach
 * the venue before failing.
 *
 * @throws TenantScopeError if the intent is not the caller's
 */
export const setOrderIntentStatus = async (
  userId: UserId,
  db: Db,
  intentId: IntentId,
  status: string,
  fields: {
    readonly venueOrderId?: VenueOrderId
    readonly rejectReason?: string
  } = {},
): Promise<OrderIntentRow> => {
  const set: Partial<typeof orderIntents.$inferInsert> = { status }
  if (fields.venueOrderId !== undefined) set.venueOrderId = fields.venueOrderId
  if (fields.rejectReason !== undefined) set.rejectReason = fields.rejectReason

  const [row] = await db
    .update(orderIntents)
    .set(set)
    .where(and(eq(orderIntents.id, intentId), eq(orderIntents.userId, userId)))
    .returning()
  if (row === undefined) {
    throw new TenantScopeError("order_intents", intentId, userId)
  }
  return row
}
