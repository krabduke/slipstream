/**
 * The log field allowlist.
 *
 * THE LOAD-BEARING DESIGN HERE: a field name must appear in this set before its
 * value can ever reach the log output. Anything absent is dropped — not masked,
 * not truncated, not hashed. Dropped. See docs/04 §2 and docs/01 §6.
 *
 * This is the inverse of the usual approach and the inversion is the whole
 * point. A denylist of forbidden names ("password", "privateKey", "secret") is
 * a list of the leaks somebody already thought of; it fails open on the field
 * nobody thought of — `agentKey`, `wrappedDek`, `signerMaterial`, a venue
 * response spread wholesale into a context object. An allowlist fails closed on
 * exactly those, because the default answer for an unknown name is "no".
 *
 * Consequences you must accept when working on this file:
 *
 *  - Adding a name here is a security decision, and the diff is the review
 *    checkpoint. Ask "could any value ever placed under this name be key
 *    material, a credential, or a raw venue payload?" before adding one.
 *  - There is deliberately no runtime API to extend this set. A caller that
 *    could widen the allowlist at runtime is a caller that can defeat it, and
 *    the extension would not appear in any diff.
 *  - Generic container names (`data`, `body`, `payload`, `response`, `params`,
 *    `args`, `raw`, `input`, `result`, `value`) are absent on purpose. They are
 *    the names people reach for when logging a whole object they have not
 *    inspected, which is the exact behaviour this module exists to stop.
 *  - Opting a name in opts in its *value*, unexamined. `SignerKey` is a plain
 *    string at runtime (see secret.ts), so nothing here can distinguish key
 *    material from any other string. The allowlist bounds where a key could
 *    surface; it does not make logging one safe. Keys must never be handed to
 *    the logger at all.
 */

/** Correlation and identity. Opaque identifiers, never credentials. */
const IDENTIFIERS = [
  "id",
  "userId",
  "leaderId",
  "subscriptionId",
  "venueAccountId",
  "intentId",
  "orderId",
  "venueOrderId",
  "venueFillId",
  "idempotencyKey",
  "requestId",
  "traceId",
  "spanId",
  /** The public on-chain wallet being copied. Not a secret, and the single
   *  most useful field when reconstructing why a trade happened.
   *  Note the absence of `address`, `ownerAddress` and `signerAddress`: a
   *  follower's wallet ties a user identity to a chain identity, and `userId`
   *  already answers every operational question about them. */
  "leaderAddress",
] as const

/** Domain vocabulary from contracts/intents.ts. Closed sets and identifiers. */
const DOMAIN = [
  "kind",
  "venue",
  "marketId",
  "side",
  "mode",
  "status",
  "phase",
  "state",
  "event",
  "action",
  "outcome",
  "reason",
  "reasonCode",
  /** SkipDecision.detail — pre-formatted numeric strings behind a decision. */
  "detail",
  "sizingMode",
  "paperMode",
] as const

/** Numbers. Every one of these is a quantity the decision ledger explains
 *  itself with; none of them is a place a credential could plausibly land. */
const QUANTITIES = [
  "size",
  "filledSize",
  "remainingSize",
  "price",
  "limitPrice",
  "avgPrice",
  "bestBid",
  "bestAsk",
  "notional",
  "equity",
  "leverage",
  "pnl",
  "realizedPnl",
  "unrealizedPnl",
  "fee",
  "bps",
  "slippageBps",
  "limitBps",
  "observedBps",
  "multiplier",
  "percent",
  "count",
  "attempt",
  "attempts",
  "retries",
  "drift",
  "lag",
  "queueDepth",
  "rateLimitRemaining",
] as const

/** Time. */
const TIMING = [
  "ts",
  "timestamp",
  "createdAt",
  "updatedAt",
  "startedAt",
  "finishedAt",
  "durationMs",
  "latencyMs",
  "ageMs",
  "staleMs",
  "elapsedMs",
  "retryAfterMs",
  "oldestEntryAgeMs",
  "connectionAgeMs",
] as const

/** Process and deployment identity. */
const RUNTIME = ["service", "component", "logger", "version", "pid", "nodeEnv"] as const

/**
 * Transport. Deliberately narrow.
 *
 * `url`, `path`, `endpoint`, `query` and `headers` are absent: a URL carries a
 * query string, a query string carries whatever the caller put in it, and a
 * header carries an Authorization value. `route` is a compile-time template
 * (`/api/orders/:id`), which is why it is the one that survives.
 */
const TRANSPORT = ["method", "route", "statusCode"] as const

/**
 * Error shape. These are the fields `redactError` writes, and they must be
 * allowlisted so that an error nested inside an ordinary object survives the
 * same filter — errors get no special exemption, only special *extraction*.
 *
 * `message` and `stack` are opted in with open eyes: a stack contains file
 * paths and function names but never argument values, and both are the minimum
 * needed for an unattended trading process to be debuggable at 3am. Neither is
 * a licence to interpolate key material into an error string — docs/04 §2
 * forbids that at the throw site, which is the only place it can be prevented.
 */
const ERRORS = [
  "err",
  "error",
  "errors",
  "cause",
  "name",
  "message",
  "stack",
  "code",
  "errno",
  "syscall",
  "type",
] as const

/**
 * Every field name that may appear in log output.
 *
 * Frozen, and exported read-only. `has` is the only question anybody asks it.
 */
export const LOG_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  ...IDENTIFIERS,
  ...DOMAIN,
  ...QUANTITIES,
  ...TIMING,
  ...RUNTIME,
  ...TRANSPORT,
  ...ERRORS,
])

/** True when `key` may be logged. The default answer is false. */
export const isAllowedField = (key: string): boolean => LOG_ALLOWLIST.has(key)
