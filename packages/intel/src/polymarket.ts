/**
 * Polymarket trader intelligence. Reading is not geoblocked; only trading is.
 *
 * Sources (data-api.polymarket.com, public):
 *   /v1/leaderboard       PnL + volume per window; filterable by `user`
 *   /closed-positions     realised PnL per market position, newest first, 50/page
 *   /positions            open positions with mark-to-market PnL
 *   /value                current portfolio value
 *
 * Polymarket has no account-value history, so "return" here is realised PnL
 * per dollar staked across closed positions — the edge per bet — and
 * drawdown is measured on the cumulative realised-PnL curve against the
 * capital the wallet shows (portfolio value plus the curve's peak). Both are
 * labelled as such in the UI; neither is comparable 1:1 with Hyperliquid's.
 */
import { batcher, fetchJson, pool, sleep } from "./http.js"
import { consistency, maxDrawdown, weeklyChanges, weeklySharpe, type Point } from "./metrics.js"
import { isCopyable, scoreFrom, scoreParts } from "./score.js"
import type { CopyFlag, OpenPosition, RecentTrade, TraderProfile, WindowPnl } from "./types.js"

const DATA = "https://data-api.polymarket.com"

interface LbRow {
  rank: string
  proxyWallet: string
  userName: string | null
  vol: number
  pnl: number
}

interface ClosedPosition {
  conditionId: string
  avgPrice: number
  totalBought: number
  realizedPnl: number
  timestamp: number
  endDate: string | null
  title: string
  slug: string
  eventSlug: string | null
  outcome: string
}

interface OpenPositionRaw {
  size: number
  avgPrice: number
  initialValue: number
  currentValue: number
  cashPnl: number
  curPrice: number
  redeemable: boolean
  title: string
  slug: string
  eventSlug: string | null
  outcome: string
  endDate: string | null
}

type Window = "day" | "week" | "month" | "all"
const WINDOWS: Window[] = ["day", "week", "month", "all"]

// Gentle pacing: data-api has no published limit, and nothing here is urgent.
let last = 0
async function get<T>(path: string): Promise<T> {
  const wait = last + 120 - Date.now()
  if (wait > 0) await sleep(wait)
  last = Date.now()
  return fetchJson<T>(`${DATA}${path}`, { timeoutMs: 30_000 })
}

/** Polymarket's default username is the wallet address plus a timestamp
 *  ("0x5966…f804-1777648534241"); that is not a name. */
export function cleanName(name: string | null | undefined): string | null {
  if (!name) return null
  return /^0x[0-9a-f]{40}(-\d+)?$/i.test(name.trim()) ? null : name.trim()
}

export interface PmCandidate {
  readonly address: string
  readonly displayName: string | null
}

/** Union of the all-time, monthly and weekly PnL leaders. */
export async function pmCandidates(limit = 200): Promise<PmCandidate[]> {
  const pages: [Window, number][] = [
    ["all", 8],
    ["month", 6],
    ["week", 2],
  ]
  const out = new Map<string, PmCandidate>()
  for (const [w, n] of pages) {
    for (let i = 0; i < n; i++) {
      const rows = await get<LbRow[]>(`/v1/leaderboard?timePeriod=${w}&orderBy=PNL&limit=50&offset=${i * 50}`)
      for (const r of rows) {
        const a = r.proxyWallet.toLowerCase()
        if (!out.has(a)) out.set(a, { address: a, displayName: cleanName(r.userName) })
      }
      if (rows.length < 50) break
    }
  }
  return [...out.values()].slice(0, Math.max(limit, 0) || undefined)
}

/** 5- and 15-minute crypto "Up or Down" markets resolve before a copy can matter. */
export function isShortHorizon(p: { slug: string; title: string }): boolean {
  return /updown-\d+m|up-or-down-\d+m/i.test(p.slug) || /up or down - .*\d{1,2}:\d{2}(am|pm)-\d{1,2}:\d{2}(am|pm)/i.test(p.title)
}

const round2 = (x: number) => Math.round(x * 100) / 100

export async function profilePolymarket(c: PmCandidate): Promise<TraderProfile> {
  const windows = await Promise.all(
    WINDOWS.map((w) => get<LbRow[]>(`/v1/leaderboard?timePeriod=${w}&orderBy=PNL&user=${c.address}`)),
  )
  const pnl = Object.fromEntries(WINDOWS.map((w, i) => [w, windows[i]?.[0]?.pnl ?? null])) as unknown as WindowPnl
  const vol = Object.fromEntries(WINDOWS.map((w, i) => [w, windows[i]?.[0]?.vol ?? null])) as Record<Window, number | null>

  const closed: ClosedPosition[] = []
  for (let page = 0; page < 10; page++) {
    const rows = await get<ClosedPosition[]>(
      `/closed-positions?user=${c.address}&limit=50&offset=${page * 50}&sortBy=TIMESTAMP&sortDirection=DESC`,
    )
    closed.push(...rows)
    if (rows.length < 50) break
  }
  const open = await get<OpenPositionRaw[]>(`/positions?user=${c.address}&limit=200&sortBy=CURRENT&sizeThreshold=1`)
  const valueRows = await get<{ value: number }[]>(`/value?user=${c.address}`)
  const value = valueRows[0]?.value ?? null

  // Oldest first for curves.
  const asc = [...closed].sort((a, b) => a.timestamp - b.timestamp)
  let cum = 0
  const curve: Point[] = asc.map((p) => ({ t: p.timestamp * 1000, v: (cum += p.realizedPnl) }))
  const peak = curve.reduce((m, p) => Math.max(m, p.v), 0)
  // The capital the wallet has shown: its current value or its peak realised
  // profit, whichever is larger. Summing them (the first version) roughly
  // halved every drawdown and let Polymarket wallets out-score Hyperliquid
  // ones on risk they had not earned.
  const capital = Math.max(value ?? 0, peak, 1_000)
  const rawDd = maxDrawdown(curve, () => capital)
  // An emptied wallet (value 0) can fall further than the capital proxy; a
  // drawdown above 100% is meaningless, so cap it.
  const dd = { abs: rawDd.abs, pct: rawDd.pct === null ? null : Math.min(rawDd.pct, 1) }
  const weekly = weeklyChanges([{ t: (asc[0]?.timestamp ?? 0) * 1000, v: 0 }, ...curve])
  const cons = consistency(weekly)

  const wins = closed.filter((p) => p.realizedPnl > 0)
  const staked = closed.reduce((a, p) => a + p.totalBought * p.avgPrice, 0)
  const realised = closed.reduce((a, p) => a + p.realizedPnl, 0)
  const edge = staked > 0 ? realised / staked : null

  const byMarket = new Map<string, number>()
  for (const p of wins) {
    const k = p.eventSlug || p.slug
    byMarket.set(k, (byMarket.get(k) ?? 0) + p.realizedPnl)
  }
  const gross = [...byMarket.values()].reduce((a, b) => a + b, 0)
  const ranked = [...byMarket.entries()].sort((a, b) => b[1] - a[1])
  const titleOf = new Map(closed.map((p) => [p.eventSlug || p.slug, p.title]))
  const topMarkets = ranked.slice(0, 5).map(([k, v]) => ({ name: titleOf.get(k) ?? k, share: gross > 0 ? round2(v / gross) : 0 }))
  const topShare = gross > 0 && ranked[0] ? ranked[0][1] / gross : null

  const shortHorizon = closed.length ? closed.filter(isShortHorizon).length / closed.length : 0
  const lastTs = closed[0]?.timestamp ?? 0

  const flags: CopyFlag[] = []
  if (shortHorizon > 0.5) flags.push("short_horizon_markets")
  if (closed.length < 20) flags.push("low_sample")
  if (topShare !== null && topShare > 0.6) flags.push("one_big_win")
  if (!lastTs || Date.now() / 1000 - lastTs > 30 * 86_400) flags.push("inactive")
  // Hundreds of closed positions in the fetched window within a couple of days
  // is automated turnover, not a view anyone could follow.
  const spanDays = asc.length > 1 ? (asc[asc.length - 1]!.timestamp - asc[0]!.timestamp) / 86_400 : null
  const perDay = spanDays && spanDays > 0 ? closed.length / spanDays : null
  if (perDay !== null && closed.length >= 100 && perDay > 60) flags.push("high_frequency")

  const parts = scoreParts({
    roiMonth: null,
    roiAll: edge,
    positiveWindows: [pnl.week, pnl.month, pnl.all].map((v) => (v === null ? null : v > 0)),
    consistencyRatio: cons.ratio,
    activeWeeks: cons.total,
    maxDrawdownPct: dd.pct,
    tradeCount: closed.length,
    topShare,
  })

  const openPositions: OpenPosition[] = open
    .filter((p) => !p.redeemable && p.currentValue > 0)
    .slice(0, 50)
    .map((p) => ({
      market: p.title,
      side: p.outcome,
      size: p.size,
      entryPrice: p.avgPrice,
      markPrice: p.curPrice,
      valueUsd: p.currentValue,
      unrealizedPnl: p.cashPnl,
      leverage: null,
      url: `https://polymarket.com/event/${p.eventSlug || p.slug}`,
    }))

  const recentTrades: RecentTrade[] = closed.slice(0, 25).map((p) => ({
    at: p.timestamp * 1000,
    market: p.title,
    action: `Closed ${p.outcome}`,
    size: p.totalBought,
    price: p.avgPrice,
    pnl: p.realizedPnl,
  }))

  const downsampled: [number, number][] =
    curve.length <= 120
      ? curve.map((p) => [p.t, round2(p.v)])
      : Array.from({ length: 120 }, (_, i) => {
          const p = curve[Math.round((i * (curve.length - 1)) / 119)]!
          return [p.t, round2(p.v)]
        })

  return {
    venue: "polymarket",
    address: c.address,
    displayName: c.displayName,
    accountValue: value,
    pnl,
    // ROI per window is not derivable without account history; `all` carries
    // the realised edge per dollar staked instead, as labelled in the UI.
    roi: { day: null, week: null, month: null, all: edge },
    volumeMonth: vol.month,
    maxDrawdownPct: dd.pct,
    maxDrawdownAbs: dd.abs,
    profitableWeeks: cons.profitable,
    activeWeeks: cons.total,
    weeklySharpe: weeklySharpe(weekly),
    tradeCount: closed.length,
    winRate: closed.length ? wins.length / closed.length : null,
    medianHoldSecs: null,
    tradesPerDay: perDay,
    marketsTraded: new Set(closed.map((p) => p.eventSlug || p.slug)).size,
    topMarkets,
    openPositions,
    recentTrades,
    pnlCurve: downsampled,
    score: scoreFrom(parts),
    scoreParts: parts,
    copyable: isCopyable(flags),
    flags,
    refreshedAt: new Date().toISOString(),
  }
}

export async function refreshPolymarket(opts: {
  limit?: number
  concurrency?: number
  log?: (msg: string) => void
  /** Called with every 20 finished profiles, so an interrupted run keeps its progress. */
  onBatch?: (profiles: TraderProfile[]) => Promise<void>
} = {}): Promise<{ profiles: TraderProfile[]; failed: number; candidates: number }> {
  const log = opts.log ?? (() => {})
  const candidates = await pmCandidates(opts.limit ?? 200)
  log(`[intel/pm] ${candidates.length} candidates from the leaderboards`)
  const flush = batcher(opts.onBatch)
  const { ok, failed } = await pool(candidates, opts.concurrency ?? 2, async (c) => flush.add(await profilePolymarket(c)))
  await flush.done()
  for (const f of failed.slice(0, 5)) log(`[intel/pm] failed ${f.item.address}: ${f.error}`)
  return { profiles: ok, failed: failed.length, candidates: candidates.length }
}
