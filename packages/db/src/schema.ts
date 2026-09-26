/**
 * Database schema. Wave 0 (Opus); migrations and typed queries are W2.
 *
 * Three deliberate choices, each enforcing an engine invariant in the database
 * rather than in application care:
 *
 *  1. `venueFillId` is UNIQUE on both fill tables. Exactly-once processing is a
 *     constraint, not a discipline — a reconnect snapshot replaying 200 fills
 *     becomes a no-op.
 *  2. `idempotencyKey` is UNIQUE on order intents. The engine can crash between
 *     "decided" and "placed"; the retry cannot double-fill.
 *  3. `decisions` is append-only. Never updated, never deleted. It is the audit
 *     trail, the debugging tool and a user-facing feature at once.
 *
 * Money is `numeric(38, 18)`, read and written as strings and parsed to
 * `Decimal`. Never `real`, never `double precision`. See docs/02 §5.
 */
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

const money = (name: string) => numeric(name, { precision: 38, scale: 18 })
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" })

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    address: text("address").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at"),
  },
  (t) => [uniqueIndex("users_address_idx").on(t.address)],
)

/**
 * `ownerAddress`, `signerAddress` and `funderAddress` are three DIFFERENT
 * addresses on Polymarket and must never be conflated. Positions are keyed by
 * the funder (proxy/deposit wallet); orders are signed by the signer; only the
 * owner can withdraw. See docs/02 §3 and docs/04 §1.
 */
export const venueAccounts = pgTable(
  "venue_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    venue: text("venue").notNull(),
    ownerAddress: text("owner_address").notNull(),
    signerAddress: text("signer_address").notNull(),
    funderAddress: text("funder_address"),
    status: text("status").notNull().default("active"),
    /** Verbatim record of how delegation was proven, for the audit log. */
    delegationMethod: text("delegation_method").notNull(),
    verifiedAt: ts("verified_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("venue_accounts_user_idx").on(t.userId),
    uniqueIndex("venue_accounts_venue_owner_idx").on(t.venue, t.ownerAddress),
  ],
)

/** Envelope-encrypted key material. No plaintext column exists, by design. */
export const encryptedKeys = pgTable(
  "encrypted_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueAccountId: uuid("venue_account_id")
      .notNull()
      .references(() => venueAccounts.id, { onDelete: "cascade" }),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    wrappedDek: text("wrapped_dek").notNull(),
    kmsKeyId: text("kms_key_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    rotatedAt: ts("rotated_at"),
  },
  (t) => [uniqueIndex("encrypted_keys_account_idx").on(t.venueAccountId)],
)

export const leaders = pgTable(
  "leaders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venue: text("venue").notNull(),
    address: text("address").notNull(),
    label: text("label"),
    firstIndexedAt: ts("first_indexed_at").notNull().defaultNow(),
    lastEventAt: ts("last_event_at"),
  },
  (t) => [uniqueIndex("leaders_venue_address_idx").on(t.venue, t.address)],
)

export const leaderFills = pgTable(
  "leader_fills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leaderId: uuid("leader_id")
      .notNull()
      .references(() => leaders.id, { onDelete: "cascade" }),
    venueMarketId: text("venue_market_id").notNull(),
    side: text("side").notNull(),
    price: money("price").notNull(),
    size: money("size").notNull(),
    fee: money("fee").notNull(),
    closedPnl: money("closed_pnl"),
    ts: ts("ts").notNull(),
    venueFillId: text("venue_fill_id").notNull(),
  },
  (t) => [
    // Exactly-once, enforced by the database.
    uniqueIndex("leader_fills_venue_fill_idx").on(t.venueFillId),
    index("leader_fills_leader_ts_idx").on(t.leaderId, t.ts),
  ],
)

export const leaderStats = pgTable(
  "leader_stats",
  {
    leaderId: uuid("leader_id")
      .notNull()
      .references(() => leaders.id, { onDelete: "cascade" }),
    window: text("window").notNull(),
    pnl: money("pnl").notNull(),
    roi: money("roi").notNull(),
    winRate: money("win_rate").notNull(),
    maxDrawdown: money("max_drawdown").notNull(),
    avgHoldSecs: integer("avg_hold_secs").notNull(),
    tradeCount: integer("trade_count").notNull(),
    computedAt: ts("computed_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("leader_stats_pk").on(t.leaderId, t.window)],
)

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leaderId: uuid("leader_id")
      .notNull()
      .references(() => leaders.id, { onDelete: "restrict" }),
    venueAccountId: uuid("venue_account_id")
      .notNull()
      .references(() => venueAccounts.id, { onDelete: "cascade" }),
    sizingMode: text("sizing_mode").notNull(),
    sizingParam: money("sizing_param").notNull(),
    marketFilter: jsonb("market_filter").notNull(),
    /** New subscriptions default to paper. Switching to live is a step-up
     *  action requiring a fresh signature. See docs/04 §5. */
    isPaper: boolean("is_paper").notNull().default(true),
    status: text("status").notNull().default("active"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("subscriptions_user_idx").on(t.userId)],
)

export const riskProfiles = pgTable(
  "risk_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** null = the user's account-wide default. */
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "cascade",
    }),
    maxNotionalPerPosition: money("max_notional_per_position").notNull(),
    maxPositionPctEquity: money("max_position_pct_equity").notNull(),
    maxTotalExposure: money("max_total_exposure").notNull(),
    maxLeverage: money("max_leverage").notNull(),
    maxSlippageBps: integer("max_slippage_bps").notNull(),
    maxSignalAgeMs: integer("max_signal_age_ms").notNull(),
    maxBookPct: money("max_book_pct").notNull(),
    dailyLossLimit: money("daily_loss_limit").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("risk_profiles_scope_idx").on(t.userId, t.subscriptionId)],
)

export const orderIntents = pgTable(
  "order_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    venue: text("venue").notNull(),
    marketId: text("market_id").notNull(),
    side: text("side").notNull(),
    size: money("size").notNull(),
    limitPrice: money("limit_price"),
    kind: text("kind").notNull(),
    /** "trade" | "exit" — exits bypass the gate; see docs/03 §5. */
    intentKind: text("intent_kind").notNull(),
    exitReason: text("exit_reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"),
    venueOrderId: text("venue_order_id"),
    rejectReason: text("reject_reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    // Crash between "decided" and "placed" cannot double-fill.
    uniqueIndex("order_intents_idempotency_idx").on(t.idempotencyKey),
    index("order_intents_user_status_idx").on(t.userId, t.status),
  ],
)

export const fills = pgTable(
  "fills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderIntentId: uuid("order_intent_id").references(() => orderIntents.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    venueFillId: text("venue_fill_id").notNull(),
    marketId: text("market_id").notNull(),
    side: text("side").notNull(),
    price: money("price").notNull(),
    size: money("size").notNull(),
    fee: money("fee").notNull(),
    ts: ts("ts").notNull(),
  },
  (t) => [
    uniqueIndex("fills_venue_fill_idx").on(t.venueFillId),
    index("fills_user_ts_idx").on(t.userId, t.ts),
  ],
)

export const positionsSnapshot = pgTable(
  "positions_snapshot",
  {
    venueAccountId: uuid("venue_account_id")
      .notNull()
      .references(() => venueAccounts.id, { onDelete: "cascade" }),
    marketId: text("market_id").notNull(),
    side: text("side").notNull(),
    size: money("size").notNull(),
    entryPrice: money("entry_price").notNull(),
    unrealizedPnl: money("unrealized_pnl").notNull(),
    ts: ts("ts").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("positions_snapshot_pk").on(t.venueAccountId, t.marketId)],
)

/**
 * APPEND-ONLY. Never updated, never deleted.
 * `verdict` is one of "copied" | "exited" | "skipped" | "rejected".
 * `reasonCode` is the closed set from shared/contracts/intents.ts.
 */
export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    venue: text("venue").notNull(),
    marketId: text("market_id").notNull(),
    verdict: text("verdict").notNull(),
    reasonCode: text("reason_code"),
    detail: jsonb("detail").notNull(),
    leaderAddress: text("leader_address"),
    leaderFillPrice: money("leader_fill_price"),
    ts: ts("ts").notNull().defaultNow(),
  },
  (t) => [index("decisions_user_ts_idx").on(t.userId, t.ts)],
)

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    ip: text("ip"),
    detail: jsonb("detail").notNull(),
    ts: ts("ts").notNull().defaultNow(),
  },
  (t) => [index("audit_log_user_ts_idx").on(t.userId, t.ts)],
)

/** Engine shard leases. See docs/01 §3. */
export const engineLeases = pgTable("engine_leases", {
  shard: integer("shard").primaryKey(),
  holder: text("holder").notNull(),
  expiresAt: ts("expires_at").notNull(),
  heartbeatAt: ts("heartbeat_at").notNull().defaultNow(),
})

/** Durable half of the kill switch. Redis holds the fast half; the engine
 *  treats "either says stop" as stop. See docs/04 §6. */
export const killSwitches = pgTable(
  "kill_switches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull(),
    scopeId: text("scope_id"),
    active: boolean("active").notNull().default(false),
    flatten: boolean("flatten").notNull().default(false),
    setBy: text("set_by").notNull(),
    setAt: ts("set_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("kill_switches_scope_idx").on(t.scope, t.scopeId)],
)

export const siweNonces = pgTable("siwe_nonces", {
  nonce: text("nonce").primaryKey(),
  address: text("address"),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
})

// ── Trader intelligence ──────────────────────────────────────────────────────
//
// Analytics about other people's public wallets, refreshed by the engine's
// intel job and read by the Traders pages. These are statistics for humans,
// never inputs to an order, so they are plain doubles: the money rule above
// (numeric, never floats) covers every column that can reach an order, and
// none of these can. The full profile (curves, positions, recent trades) is a
// jsonb blob; the columns beside it exist only to sort and filter on.

export const traderProfiles = pgTable(
  "trader_profiles",
  {
    venue: text("venue").notNull(),
    address: text("address").notNull(),
    displayName: text("display_name"),
    score: integer("score").notNull(),
    copyable: boolean("copyable").notNull(),
    flags: text("flags").array().notNull(),
    accountValue: doublePrecision("account_value"),
    pnlWeek: doublePrecision("pnl_week"),
    pnlMonth: doublePrecision("pnl_month"),
    pnlAll: doublePrecision("pnl_all"),
    roiMonth: doublePrecision("roi_month"),
    roiAll: doublePrecision("roi_all"),
    maxDrawdown: doublePrecision("max_drawdown"),
    winRate: doublePrecision("win_rate"),
    tradeCount: integer("trade_count").notNull(),
    profile: jsonb("profile").notNull(),
    refreshedAt: ts("refreshed_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trader_profiles_pk").on(t.venue, t.address),
    index("trader_profiles_venue_score_idx").on(t.venue, t.score),
  ],
)

/** One row per intel refresh, so staleness is visible and alarmable. */
export const intelRuns = pgTable(
  "intel_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venue: text("venue").notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    candidates: integer("candidates"),
    profiled: integer("profiled"),
    failed: integer("failed"),
    error: text("error"),
  },
  (t) => [index("intel_runs_venue_started_idx").on(t.venue, t.startedAt)],
)

// ── Paper trading ────────────────────────────────────────────────────────────
//
// Each paper subscription trades its own simulated book, so "what would
// following this wallet have done" is answered per leader rather than blended.
// The paper executor fills against the live order book (docs/03 §9); these
// tables hold only the result. Money columns are numeric, like every other
// column an order can touch.

export const paperBooks = pgTable("paper_books", {
  subscriptionId: uuid("subscription_id")
    .primaryKey()
    .references(() => subscriptions.id, { onDelete: "cascade" }),
  startingEquity: money("starting_equity").notNull(),
  realizedPnl: money("realized_pnl").notNull().default("0"),
  feesPaid: money("fees_paid").notNull().default("0"),
  /** Marked-to-market equity, written by the engine each cycle for display. */
  equity: money("equity"),
  equityAt: ts("equity_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
})

export const paperPositions = pgTable(
  "paper_positions",
  {
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    marketId: text("market_id").notNull(),
    /** Human label (Polymarket market ids are long token ids). */
    label: text("label"),
    side: text("side").notNull(),
    size: money("size").notNull(),
    entryPrice: money("entry_price").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("paper_positions_pk").on(t.subscriptionId, t.marketId)],
)

