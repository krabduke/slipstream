/**
 * The data-access layer.
 *
 * ## The rule
 *
 * Every helper that touches a user-owned table takes an explicit `userId` as
 * its **first parameter**, and there is no unscoped variant of any of them —
 * not even a private one that a scoped helper wraps. Tenant scoping lives
 * here rather than in route handlers precisely so that a future caller cannot
 * forget it: there is nothing to forget, because there is nothing else to
 * call. See docs/04 §5.
 *
 * User-owned tables, all reached through `userId`-first helpers:
 * `users`, `venue_accounts`, `encrypted_keys`, `subscriptions`,
 * `risk_profiles`, `order_intents`, `fills`, `positions_snapshot`,
 * `decisions`, `audit_log`.
 *
 * `encrypted_keys` and `positions_snapshot` have no `user_id` column of their
 * own; their helpers join through `venue_accounts` on the caller's `userId`,
 * or prove ownership with `requireOwnedVenueAccount` first.
 *
 * ## The one exception, and why it is not a loophole
 *
 * `leaders`, `leader_fills` and `leader_stats` are the public leaderboard.
 * They have no `user_id` column and no tenant dimension — they describe
 * wallets on a public chain and are identical for every viewer. Their helpers
 * (in `./leaders.js`) take `db` first and no `userId`, because there is no
 * user to scope to. None of them reads or writes a user-owned table.
 *
 * ## Not covered here
 *
 * `engine_leases`, `kill_switches` and `siwe_nonces` have no helpers in this
 * package. Their semantics — lease fencing, kill-switch precedence between
 * Redis and Postgres, single-use nonces — are decisions owned by the engine,
 * risk and auth waves rather than by the data layer.
 *
 * ## Money
 *
 * Every `numeric(38,18)` column crosses this boundary as a **string**, exactly
 * as Postgres returned it. Nothing here parses one to a `number`. Callers
 * convert with `money.parse` from `@slipstream/shared`. See docs/02 §5.
 *
 * ## Append-only tables
 *
 * `./decisions.js` and `./audit-log.js` export inserts and reads only. There
 * is no update or delete helper for either, deliberately.
 */
export * from "./types.js"
export * from "./errors.js"

export * from "./users.js"
export * from "./venue-accounts.js"
export * from "./encrypted-keys.js"
export * from "./subscriptions.js"
export * from "./risk-profiles.js"
export * from "./order-intents.js"
export * from "./fills.js"
export * from "./positions.js"
export * from "./decisions.js"
export * from "./audit-log.js"

export * from "./leaders.js"
export * from "./intel.js"
