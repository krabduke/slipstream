/**
 * The engine's database access.
 *
 * The data layer's rule is that every user-owned table is reached through a
 * `userId`-first helper (packages/db/src/queries). The engine is the one
 * component that legitimately works across all users — it serves every active
 * follow — so its cross-user reads live here, in one file, instead of being
 * scattered. Every WRITE below is still scoped to the subscription or user it
 * was read for.
 */
import { and, eq, inArray, sql } from "drizzle-orm"

import type { Db } from "@slipstream/db"
import { schema } from "@slipstream/db"

const {
  decisions,
  encryptedKeys,
  engineLeases,
  killSwitches,
  leaders,
  orderIntents,
  paperBooks,
  paperPositions,
  riskProfiles,
  subscriptions,
  venueAccounts,
} = schema

export interface ActiveFollow {
  subscriptionId: string
  userId: string
  venue: "hyperliquid" | "polymarket"
  leaderAddress: string
  leaderLabel: string | null
  sizingMode: string
  sizingParam: string
  marketFilter: unknown
  isPaper: boolean
  venueAccountId: string
  ownerAddress: string
  signerAddress: string
  startingEquity: string | null
  realizedPnl: string | null
  feesPaid: string | null
}

export async function loadActiveFollows(db: Db): Promise<ActiveFollow[]> {
  const rows = await db
    .select({
      subscriptionId: subscriptions.id,
      userId: subscriptions.userId,
      venue: leaders.venue,
      leaderAddress: leaders.address,
      leaderLabel: leaders.label,
      sizingMode: subscriptions.sizingMode,
      sizingParam: subscriptions.sizingParam,
      marketFilter: subscriptions.marketFilter,
      isPaper: subscriptions.isPaper,
      venueAccountId: venueAccounts.id,
      ownerAddress: venueAccounts.ownerAddress,
      signerAddress: venueAccounts.signerAddress,
      startingEquity: paperBooks.startingEquity,
      realizedPnl: paperBooks.realizedPnl,
      feesPaid: paperBooks.feesPaid,
    })
    .from(subscriptions)
    .innerJoin(leaders, eq(leaders.id, subscriptions.leaderId))
    .innerJoin(venueAccounts, eq(venueAccounts.id, subscriptions.venueAccountId))
    .leftJoin(paperBooks, eq(paperBooks.subscriptionId, subscriptions.id))
    .where(eq(subscriptions.status, "active"))
  return rows.filter((r) => r.venue === "hyperliquid" || r.venue === "polymarket") as ActiveFollow[]
}

export interface KillRow {
  scope: string
  scopeId: string | null
  flatten: boolean
}

export async function loadKillSwitches(db: Db): Promise<KillRow[]> {
  return db
    .select({ scope: killSwitches.scope, scopeId: killSwitches.scopeId, flatten: killSwitches.flatten })
    .from(killSwitches)
    .where(eq(killSwitches.active, true))
}

export async function loadRiskProfiles(db: Db, userIds: readonly string[]) {
  if (!userIds.length) return []
  return db.select().from(riskProfiles).where(inArray(riskProfiles.userId, [...userIds]))
}

// ── Paper books ────────────────────────────────────────────────────────────

export async function loadPaperPositions(db: Db, subscriptionIds: readonly string[]) {
  if (!subscriptionIds.length) return []
  return db.select().from(paperPositions).where(inArray(paperPositions.subscriptionId, [...subscriptionIds]))
}

export async function savePaperPosition(
  db: Db,
  subscriptionId: string,
  marketId: string,
  label: string | null,
  pos: { side: string; size: string; entryPrice: string } | null,
) {
  if (!pos) {
    await db
      .delete(paperPositions)
      .where(and(eq(paperPositions.subscriptionId, subscriptionId), eq(paperPositions.marketId, marketId)))
    return
  }
  await db
    .insert(paperPositions)
    .values({ subscriptionId, marketId, label, side: pos.side, size: pos.size, entryPrice: pos.entryPrice })
    .onConflictDoUpdate({
      target: [paperPositions.subscriptionId, paperPositions.marketId],
      set: { side: pos.side, size: pos.size, entryPrice: pos.entryPrice, label, updatedAt: new Date() },
    })
}

export async function bookRealized(db: Db, subscriptionId: string, realized: string, fee: string) {
  await db
    .update(paperBooks)
    .set({
      realizedPnl: sql`${paperBooks.realizedPnl} + ${realized}::numeric`,
      feesPaid: sql`${paperBooks.feesPaid} + ${fee}::numeric`,
    })
    .where(eq(paperBooks.subscriptionId, subscriptionId))
}

export async function markPaperEquity(db: Db, subscriptionId: string, equity: string) {
  await db
    .update(paperBooks)
    .set({ equity, equityAt: new Date() })
    .where(eq(paperBooks.subscriptionId, subscriptionId))
}

// ── Ledger ─────────────────────────────────────────────────────────────────

export interface LedgerEntry {
  userId: string
  subscriptionId: string | null
  venue: string
  marketId: string
  verdict: "copied" | "exited" | "skipped" | "rejected"
  reasonCode: string | null
  detail: Record<string, unknown>
  leaderAddress: string | null
  leaderFillPrice: string | null
}

export async function writeLedger(db: Db, entries: readonly LedgerEntry[]) {
  if (!entries.length) return
  await db.insert(decisions).values(entries.map((e) => ({ ...e })))
}

/** Realised paper PnL today for the daily-loss gate, from the ledger itself. */
export async function realizedToday(db: Db, subscriptionId: string): Promise<string> {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const rows = await db.execute(sql`
    select coalesce(sum((detail->>'realizedPnl')::numeric), 0)::text as total
    from ${decisions}
    where subscription_id = ${subscriptionId} and ts >= ${start.toISOString()}
      and detail ? 'realizedPnl'
  `)
  const r = (rows as unknown as { rows: { total: string }[] }).rows[0]
  return r?.total ?? "0"
}

// ── Live orders ────────────────────────────────────────────────────────────

/**
 * Claim an idempotency key before placing a live order. Returns false when the
 * key already exists — the order was already attempted (possibly by a crashed
 * previous run) and must not be sent again (docs/02 §6).
 */
export async function claimIntent(
  db: Db,
  row: {
    id: string
    userId: string
    subscriptionId: string | null
    venue: string
    marketId: string
    side: string
    size: string
    kind: string
    intentKind: "trade" | "exit"
    exitReason: string | null
    idempotencyKey: string
  },
): Promise<boolean> {
  const inserted = await db
    .insert(orderIntents)
    .values({ ...row, status: "submitting" })
    .onConflictDoNothing({ target: orderIntents.idempotencyKey })
    .returning({ id: orderIntents.id })
  return inserted.length === 1
}

export async function settleIntent(
  db: Db,
  idempotencyKey: string,
  r: { status: string; venueOrderId: string | null; rejectReason: string | null },
) {
  await db
    .update(orderIntents)
    .set({ status: r.status, venueOrderId: r.venueOrderId, rejectReason: r.rejectReason })
    .where(eq(orderIntents.idempotencyKey, idempotencyKey))
}

export async function loadSealedKey(db: Db, venueAccountId: string) {
  const [row] = await db.select().from(encryptedKeys).where(eq(encryptedKeys.venueAccountId, venueAccountId)).limit(1)
  return row ?? null
}

// ── Heartbeat ──────────────────────────────────────────────────────────────

/** Shard 0 is the single-engine lease; its heartbeat is what the site's
 *  status band reads. */
export async function heartbeat(db: Db, holder: string, status: Record<string, unknown>) {
  const now = new Date()
  await db
    .insert(engineLeases)
    .values({ shard: 0, holder: JSON.stringify({ holder, ...status }), expiresAt: new Date(now.getTime() + 60_000), heartbeatAt: now })
    .onConflictDoUpdate({
      target: engineLeases.shard,
      set: { holder: JSON.stringify({ holder, ...status }), expiresAt: new Date(now.getTime() + 60_000), heartbeatAt: now },
    })
}


/** A follow whose "stop" (subscription kill with flatten) has finished
 *  flattening: mark it stopped and clear its switch. */
export async function markStopped(db: Db, subscriptionId: string) {
  await db.update(subscriptions).set({ status: "stopped" }).where(eq(subscriptions.id, subscriptionId))
  await db
    .update(killSwitches)
    .set({ active: false, flatten: false, setAt: new Date() })
    .where(and(eq(killSwitches.scope, "subscription"), eq(killSwitches.scopeId, subscriptionId)))
}
