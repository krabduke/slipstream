/**
 * Vocabulary shared by every query helper.
 *
 * Row types are named `...Row` throughout to keep them distinct from the
 * domain types in `@slipstream/shared`: a row carries money as a **string**
 * exactly as Postgres returned it, a domain type carries it as a `Decimal`.
 * Confusing the two is how a float gets into an order.
 */

/**
 * A `numeric(38, 18)` column value, verbatim from Postgres.
 *
 * Nothing in this package parses one. Callers convert with `money.parse` from
 * `@slipstream/shared` at the boundary where arithmetic starts. If a `number`
 * ever comes out of a money column something is misconfigured — do not paper
 * over it with a cast. See docs/02 §5.
 */
export type MoneyString = string

/**
 * Mirrors `OrderKind["type"]` in `@slipstream/venues`.
 *
 * Duplicated rather than imported: `db` sits below `venues` in the dependency
 * order and must not reach up into it.
 */
export type OrderKindTag = "market" | "limit"

/** The closed set in the `decisions.verdict` column. See schema.ts. */
export type DecisionVerdict = "copied" | "exited" | "skipped" | "rejected"

/** `order_intents.intent_kind`. Exits bypass the risk gate; see docs/03 §5. */
export type IntentKind = "trade" | "exit"

/**
 * Page window for a list helper.
 *
 * Every list helper applies {@link DEFAULT_LIMIT} when `limit` is omitted and
 * caps it at {@link MAX_LIMIT}. Reads against `fills` and `decisions` grow
 * without bound over an account's lifetime, so there is no "return
 * everything" mode to reach for by accident.
 */
export interface PageOptions {
  readonly limit?: number
  readonly offset?: number
}

/** Half-open time window, `since <= ts <= until`, both optional. */
export interface TimeRange {
  readonly since?: Date
  readonly until?: Date
}

export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 1000

/** Clamp a caller-supplied page size into `[1, MAX_LIMIT]`. */
export const pageLimit = (limit: number | undefined): number => {
  if (limit === undefined) return DEFAULT_LIMIT
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

/** Clamp a caller-supplied offset to a non-negative integer. */
export const pageOffset = (offset: number | undefined): number => {
  if (offset === undefined || !Number.isFinite(offset)) return 0
  return Math.max(0, Math.floor(offset))
}

/**
 * Assert that a `.returning()` insert or update produced its row.
 *
 * `noUncheckedIndexedAccess` types `rows[0]` as possibly undefined; for a
 * single-row insert it never is, and a silent `undefined` propagating out of a
 * write helper would be worse than a throw.
 */
export const requireRow = <T>(row: T | undefined, what: string): T => {
  if (row === undefined) {
    throw new Error(`${what}: write returned no row`)
  }
  return row
}
