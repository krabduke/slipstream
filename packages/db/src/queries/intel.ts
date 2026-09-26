/**
 * Trader intelligence: `trader_profiles` and `intel_runs`.
 *
 * Public data, like `./leaders.js`: these describe wallets on public chains,
 * are identical for every viewer, and are written by the engine's intel job.
 * Helpers take `db` first and no `userId` because there is no user to scope
 * to, and none of them touches a user-owned table.
 *
 * The profile itself is a jsonb blob of `TraderProfile` from @slipstream/intel;
 * the scalar columns are copies of a few of its fields, kept only to sort and
 * filter on without unpacking jsonb.
 */
import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm"

import type { Db } from "../client.js"
import { intelRuns, traderProfiles } from "../schema.js"

export type TraderProfileRow = typeof traderProfiles.$inferSelect

export interface TraderProfileInput {
  readonly venue: string
  readonly address: string
  readonly displayName: string | null
  readonly score: number
  readonly copyable: boolean
  readonly flags: readonly string[]
  readonly accountValue: number | null
  readonly pnl: { readonly week: number | null; readonly month: number | null; readonly all: number | null }
  readonly roi: { readonly month: number | null; readonly all: number | null }
  readonly maxDrawdownPct: number | null
  readonly winRate: number | null
  readonly tradeCount: number
  readonly refreshedAt: string
}

const finite = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : null)

/** Insert or replace profiles by (venue, address). Chunked to keep statements small. */
export async function upsertTraderProfiles(db: Db, profiles: readonly TraderProfileInput[]): Promise<number> {
  let written = 0
  for (let i = 0; i < profiles.length; i += 50) {
    const chunk = profiles.slice(i, i + 50).map((p) => ({
      venue: p.venue,
      address: p.address.toLowerCase(),
      displayName: p.displayName,
      score: Math.round(p.score),
      copyable: p.copyable,
      flags: [...p.flags],
      accountValue: finite(p.accountValue),
      pnlWeek: finite(p.pnl.week),
      pnlMonth: finite(p.pnl.month),
      pnlAll: finite(p.pnl.all),
      roiMonth: finite(p.roi.month),
      roiAll: finite(p.roi.all),
      maxDrawdown: finite(p.maxDrawdownPct),
      winRate: finite(p.winRate),
      tradeCount: p.tradeCount,
      profile: p as unknown as Record<string, unknown>,
      refreshedAt: new Date(p.refreshedAt),
    }))
    if (!chunk.length) continue
    await db
      .insert(traderProfiles)
      .values(chunk)
      .onConflictDoUpdate({
        target: [traderProfiles.venue, traderProfiles.address],
        set: {
          displayName: sql`excluded.display_name`,
          score: sql`excluded.score`,
          copyable: sql`excluded.copyable`,
          flags: sql`excluded.flags`,
          accountValue: sql`excluded.account_value`,
          pnlWeek: sql`excluded.pnl_week`,
          pnlMonth: sql`excluded.pnl_month`,
          pnlAll: sql`excluded.pnl_all`,
          roiMonth: sql`excluded.roi_month`,
          roiAll: sql`excluded.roi_all`,
          maxDrawdown: sql`excluded.max_drawdown`,
          winRate: sql`excluded.win_rate`,
          tradeCount: sql`excluded.trade_count`,
          profile: sql`excluded.profile`,
          refreshedAt: sql`excluded.refreshed_at`,
        },
      })
    written += chunk.length
  }
  return written
}

export type TraderSort = "score" | "pnl_month" | "pnl_all" | "roi_all" | "account_value"

export interface ListTradersOptions {
  readonly venue?: string
  readonly copyableOnly?: boolean
  readonly minAccountValue?: number
  /** Profiles not refreshed within this many hours are hidden. Default 72. */
  readonly maxAgeHours?: number
  readonly sort?: TraderSort
  readonly limit?: number
  readonly offset?: number
}

const SORT_COLUMN = {
  score: traderProfiles.score,
  pnl_month: traderProfiles.pnlMonth,
  pnl_all: traderProfiles.pnlAll,
  roi_all: traderProfiles.roiAll,
  account_value: traderProfiles.accountValue,
} as const

/** The discovery list: scalar columns only, never the jsonb blob. */
export async function listTraders(db: Db, o: ListTradersOptions = {}) {
  const where: SQL[] = [
    gte(traderProfiles.refreshedAt, new Date(Date.now() - (o.maxAgeHours ?? 72) * 3_600_000)),
  ]
  if (o.venue) where.push(eq(traderProfiles.venue, o.venue))
  if (o.copyableOnly) where.push(eq(traderProfiles.copyable, true))
  if (o.minAccountValue) where.push(gte(traderProfiles.accountValue, o.minAccountValue))
  const col = SORT_COLUMN[o.sort ?? "score"]
  return db
    .select({
      venue: traderProfiles.venue,
      address: traderProfiles.address,
      displayName: traderProfiles.displayName,
      score: traderProfiles.score,
      copyable: traderProfiles.copyable,
      flags: traderProfiles.flags,
      accountValue: traderProfiles.accountValue,
      pnlWeek: traderProfiles.pnlWeek,
      pnlMonth: traderProfiles.pnlMonth,
      pnlAll: traderProfiles.pnlAll,
      roiMonth: traderProfiles.roiMonth,
      roiAll: traderProfiles.roiAll,
      maxDrawdown: traderProfiles.maxDrawdown,
      winRate: traderProfiles.winRate,
      tradeCount: traderProfiles.tradeCount,
      refreshedAt: traderProfiles.refreshedAt,
      /** Just this slice of the jsonb, for the score strip; never the whole blob. */
      scoreParts: sql<Record<string, number> | null>`${traderProfiles.profile}->'scoreParts'`,
    })
    .from(traderProfiles)
    .where(and(...where))
    .orderBy(sql`${col} desc nulls last`, desc(traderProfiles.score))
    .limit(Math.min(o.limit ?? 50, 200))
    .offset(o.offset ?? 0)
}

export async function getTraderProfile(db: Db, venue: string, address: string): Promise<TraderProfileRow | null> {
  const rows = await db
    .select()
    .from(traderProfiles)
    .where(and(eq(traderProfiles.venue, venue), eq(traderProfiles.address, address.toLowerCase())))
    .limit(1)
  return rows[0] ?? null
}

export async function getTraderProfiles(db: Db, venue: string, addresses: readonly string[]) {
  if (!addresses.length) return []
  return db
    .select()
    .from(traderProfiles)
    .where(and(eq(traderProfiles.venue, venue), inArray(traderProfiles.address, addresses.map((a) => a.toLowerCase()))))
}

export async function startIntelRun(db: Db, venue: string): Promise<string> {
  const [row] = await db.insert(intelRuns).values({ venue }).returning({ id: intelRuns.id })
  return row!.id
}

export async function finishIntelRun(
  db: Db,
  id: string,
  r: { candidates?: number; profiled?: number; failed?: number; error?: string | null },
): Promise<void> {
  await db
    .update(intelRuns)
    .set({ finishedAt: new Date(), candidates: r.candidates, profiled: r.profiled, failed: r.failed, error: r.error ?? null })
    .where(eq(intelRuns.id, id))
}

/** Latest finished run per venue, for freshness banners and alarms. */
export interface IntelRunSummary {
  venue: string
  started_at: string | Date
  finished_at: string | Date
  candidates: number | null
  profiled: number | null
  failed: number | null
  error: string | null
}

export async function latestIntelRuns(db: Db): Promise<IntelRunSummary[]> {
  const r = await db.execute(sql`
    select distinct on (venue) venue, started_at, finished_at, candidates, profiled, failed, error
    from intel_runs
    where finished_at is not null
    order by venue, started_at desc
  `)
  // Db is the driver-agnostic PgDatabase, so execute() is typed unknown.
  return (r as unknown as { rows: IntelRunSummary[] }).rows
}
