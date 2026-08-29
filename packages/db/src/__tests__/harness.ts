/**
 * A driverless Postgres session that records the SQL a query helper emits.
 *
 * `drizzle-orm/pg-proxy` builds a real `PgDatabase` around a callback instead
 * of a socket, so these tests exercise the actual dialect — the SQL asserted
 * here is the SQL a real connection would send. That matters for the property
 * this suite exists to prove: that `where user_id = $1` is present. Proving it
 * against a mock query builder would prove nothing.
 */
import { drizzle } from "drizzle-orm/pg-proxy"

import type {
  IdempotencyKey,
  IntentId,
  LeaderId,
  MarketId,
  SubscriptionId,
  UserId,
  VenueAccountId,
  VenueFillId,
  VenueOrderId,
} from "@slipstream/shared"

import type { Db } from "../client.js"
import * as schema from "../schema.js"

export interface CapturedQuery {
  readonly sql: string
  readonly params: readonly unknown[]
  readonly method: string
}

/** One row of driver output, positional, as `pg-proxy` expects it. */
export type DriverRow = readonly unknown[]

export const USER_ID = "11111111-1111-4111-8111-111111111111" as UserId
export const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222" as UserId
export const VENUE_ACCOUNT_ID = "33333333-3333-4333-8333-333333333333" as VenueAccountId
export const SUBSCRIPTION_ID = "44444444-4444-4444-8444-444444444444" as SubscriptionId
export const LEADER_ID = "55555555-5555-4555-8555-555555555555" as LeaderId
export const INTENT_ID = "66666666-6666-4666-8666-666666666666" as IntentId
export const MARKET_ID = "BTC" as MarketId
export const VENUE_FILL_ID = "fill-1" as VenueFillId
export const VENUE_ORDER_ID = "order-1" as VenueOrderId
export const IDEMPOTENCY_KEY = "idem-1" as IdempotencyKey

/** A `venue_accounts` row in column order, for helpers that check ownership. */
export const ownedVenueAccountRow: DriverRow = [
  VENUE_ACCOUNT_ID,
  USER_ID,
  "hyperliquid",
  "0xowner",
  "0xsigner",
  "0xfunder",
  "active",
  "api_wallet",
  "2026-01-01T00:00:00.000Z",
  "2026-01-01T00:00:00.000Z",
]

export const makeRecordingDb = (
  responses: readonly (readonly DriverRow[])[] = [],
): { readonly db: Db; readonly calls: CapturedQuery[] } => {
  const calls: CapturedQuery[] = []
  const queue = [...responses]
  const db: Db = drizzle(
    async (sql, params, method) => {
      calls.push({ sql, params, method })
      return { rows: (queue.shift() ?? []) as unknown[][] }
    },
    { schema },
  )
  return { db, calls }
}

/**
 * Run a query helper and return the statements it sent.
 *
 * The fake session returns no rows by default, so write helpers throw while
 * mapping their result or on a tenant check. That is expected and irrelevant
 * to what this suite asserts, which is the SQL — captured before any mapping
 * happens. A helper that throws *before* sending a statement is not swallowed:
 * the error is rethrown when nothing was captured.
 */
export const capture = async (
  fn: (db: Db) => Promise<unknown>,
  responses: readonly (readonly DriverRow[])[] = [],
): Promise<CapturedQuery[]> => {
  const { db, calls } = makeRecordingDb(responses)
  try {
    await fn(db)
  } catch (error) {
    if (calls.length === 0) throw error
  }
  return calls
}

export const firstQuery = (calls: readonly CapturedQuery[]): CapturedQuery => {
  const first = calls[0]
  if (first === undefined) throw new Error("helper sent no SQL")
  return first
}
