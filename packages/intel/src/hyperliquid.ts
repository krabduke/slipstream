/**
 * Hyperliquid trader intelligence: leaderboard -> candidates -> deep profile.
 *
 * Sources (all public, unauthenticated):
 *   stats-data.hyperliquid.xyz/Mainnet/leaderboard   every account's day/week/month/all
 *                                                    PnL, ROI and volume (~47k rows, ~40MB)
 *   /info {type:"portfolio"}          account value + cumulative PnL history per window
 *   /info {type:"userFills"}          the most recent 2,000 fills
 *   /info {type:"clearinghouseState"} open positions
 *   /info {type:"userRole"}           rules out vaults and sub-accounts
 *
 * The per-IP limit (1,200 weight/min) is shared with the copy engine on the
 * same host, so this spends at most `weightPerMinute` of it.
 */
import { WeightBudget, fetchJson, pool } from "./http.js"
import {
  closingOrderStats,
  consistency,
  maxDrawdown,
  timeWeighted,
  roundTrips,
  tripStats,
  valueAt,
  weeklyChanges,
  weeklySharpe,
  type PerpFill,
  type Point,
} from "./metrics.js"
import { isCopyable, scoreFrom, scoreParts } from "./score.js"
import type { CopyFlag, OpenPosition, RecentTrade, TraderProfile } from "./types.js"

const INFO = "https://api.hyperliquid.xyz/info"
const LEADERBOARD = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard"

// Documented /info weights. userFills also costs 1 per 20 rows returned.
const W_PORTFOLIO = 20
const W_FILLS = 20 + 100
const W_STATE = 2
const W_ROLE = 20

interface LbRow {
  ethAddress: string
  accountValue: string
  displayName: string | null
  windowPerformances: [string, { pnl: string; roi: string; vlm: string }][]
}

export interface HlCandidate {
  readonly address: string
  readonly displayName: string | null
  readonly accountValue: number
  readonly pnl: Record<"day" | "week" | "month" | "allTime", number>
  readonly roi: Record<"day" | "week" | "month" | "allTime", number>
  readonly vlm: Record<"day" | "week" | "month" | "allTime", number>
}

const num = (s: string | undefined | null) => (s === undefined || s === null ? NaN : Number(s))

export async function fetchLeaderboard(): Promise<HlCandidate[]> {
  const body = await fetchJson<{ leaderboardRows: LbRow[] }>(LEADERBOARD, { timeoutMs: 120_000 })
  return body.leaderboardRows.map((r) => {
    const w = Object.fromEntries(r.windowPerformances) as Record<string, { pnl: string; roi: string; vlm: string }>
    const pick = (k: "pnl" | "roi" | "vlm") =>
      ({
        day: num(w.day?.[k]),
        week: num(w.week?.[k]),
        month: num(w.month?.[k]),
        allTime: num(w.allTime?.[k]),
      }) as HlCandidate["pnl"]
    return {
      address: r.ethAddress.toLowerCase(),
      displayName: r.displayName,
      accountValue: num(r.accountValue),
      pnl: pick("pnl"),
      roi: pick("roi"),
      vlm: pick("vlm"),
    }
  })
}

/**
 * Narrow ~47k accounts to the few hundred worth a deep look. Deliberately
 * wide: the deep profile, not this filter, decides the score.
 *  - at least $25k of equity (below that, results are dominated by noise)
 *  - traded this month and is net positive all-time
 *  - not an obvious market maker (monthly volume under 400x equity)
 * then the union of the best by all-time PnL and by a blended return rank.
 */
export function selectCandidates(rows: readonly HlCandidate[], limit = 200): HlCandidate[] {
  const eligible = rows.filter(
    (r) =>
      r.accountValue >= 25_000 &&
      r.vlm.month > 0 &&
      r.pnl.allTime > 0 &&
      r.vlm.month / r.accountValue < 400,
  )
  const byPnl = [...eligible].sort((a, b) => b.pnl.allTime - a.pnl.allTime).slice(0, Math.ceil(limit * 0.4))
  const blend = (r: HlCandidate) =>
    Math.min(r.roi.allTime, 5) * 0.4 + Math.min(r.roi.month, 2) * 0.4 + (r.pnl.week > 0 ? 0.2 : 0)
  const byReturn = [...eligible].sort((a, b) => blend(b) - blend(a))
  const out = new Map(byPnl.map((r) => [r.address, r]))
  for (const r of byReturn) {
    if (out.size >= limit) break
    out.set(r.address, r)
  }
  return [...out.values()]
}

type PortfolioWindow = { accountValueHistory: [number, string][]; pnlHistory: [number, string][]; vlm: string }

interface RawFill {
  coin: string
  px: string
  sz: string
  side: "A" | "B"
  time: number
  oid: number
  startPosition: string
  dir: string
  closedPnl: string
  fee: string
}

interface ClearinghouseState {
  assetPositions: {
    position: {
      coin: string
      szi: string
      entryPx: string | null
      positionValue: string
      unrealizedPnl: string
      leverage: { value: number }
      liquidationPx: string | null
    }
  }[]
  marginSummary: { accountValue: string }
}

const post = <T>(budget: WeightBudget, weight: number, body: object) =>
  budget.take(weight).then(() =>
    fetchJson<T>(INFO, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  )

const toPoints = (h: [number, string][] | undefined): Point[] =>
  (h ?? []).map(([t, v]) => ({ t, v: Number(v) })).filter((p) => Number.isFinite(p.v))

/** Keep at most `n` points, always including the last one. */
function downsample(points: readonly Point[], n = 120): [number, number][] {
  if (points.length <= n) return points.map((p) => [p.t, round2(p.v)])
  const step = (points.length - 1) / (n - 1)
  return Array.from({ length: n }, (_, i) => {
    const p = points[Math.round(i * step)]!
    return [p.t, round2(p.v)] as [number, number]
  })
}

const round2 = (x: number) => Math.round(x * 100) / 100

export async function profileHyperliquid(c: HlCandidate, budget: WeightBudget): Promise<TraderProfile> {
  const [role, portfolio, fills, state] = await Promise.all([
    post<{ role: string }>(budget, W_ROLE, { type: "userRole", user: c.address }),
    post<[string, PortfolioWindow][]>(budget, W_PORTFOLIO, { type: "portfolio", user: c.address }),
    post<RawFill[]>(budget, W_FILLS, { type: "userFills", user: c.address }),
    post<ClearinghouseState>(budget, W_STATE, { type: "clearinghouseState", user: c.address }),
  ])
  const pf = Object.fromEntries(portfolio) as Record<string, PortfolioWindow>
  const all = pf.allTime
  const pnlAll = toPoints(all?.pnlHistory)
  const equityAll = toPoints(all?.accountValueHistory)
  // Drawdown on the time-weighted index, so deposits and withdrawals cannot
  // masquerade as gains or losses. The absolute figure stays PnL-based.
  const twr = timeWeighted(equityAll, pnlAll)
  const dd = { abs: maxDrawdown(pnlAll).abs, pct: twr.maxDrawdown }
  const weekly = weeklyChanges(pnlAll)
  const cons = consistency(weekly)

  const perpFills: PerpFill[] = fills
    .filter((f) => !f.coin.startsWith("@") && f.dir !== "Buy" && f.dir !== "Sell") // perps only
    .map((f) => ({
      coin: f.coin,
      time: f.time,
      startPosition: Number(f.startPosition),
      delta: (f.side === "B" ? 1 : -1) * Number(f.sz),
      closedPnl: Number(f.closedPnl),
      fee: Number(f.fee),
    }))
  const trips = roundTrips(perpFills)
  const ts = tripStats(trips)
  const closes = closingOrderStats(
    fills.map((f) => ({ oid: f.oid, coin: f.coin, closedPnl: Number(f.closedPnl), fee: Number(f.fee), time: f.time })),
  )
  // Trips when the account goes flat often enough to measure them; otherwise
  // closing orders. Whichever has more evidence wins.
  const useTrips = ts.count >= closes.count
  const tradeCount = useTrips ? ts.count : closes.count
  const winRate = useTrips ? ts.winRate : closes.winRate
  const bestShare = useTrips ? ts.bestTripShare : closes.bestShare

  const coinPnl = new Map<string, number>()
  for (const t of trips) if (t.pnl > 0) coinPnl.set(t.coin, (coinPnl.get(t.coin) ?? 0) + t.pnl)
  const gross = [...coinPnl.values()].reduce((a, b) => a + b, 0)
  const topMarkets = [...coinPnl.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, v]) => ({ name, share: gross > 0 ? round2(v / gross) : 0 }))

  const openPositions: OpenPosition[] = state.assetPositions
    .map(({ position: p }) => {
      const szi = Number(p.szi)
      return {
        market: p.coin,
        side: szi >= 0 ? "long" : "short",
        size: Math.abs(szi),
        entryPrice: p.entryPx === null ? null : Number(p.entryPx),
        markPrice: szi !== 0 ? Math.abs(Number(p.positionValue) / szi) : null,
        valueUsd: Number(p.positionValue),
        unrealizedPnl: Number(p.unrealizedPnl),
        leverage: p.leverage?.value ?? null,
        url: `https://app.hyperliquid.xyz/trade/${p.coin}`,
      }
    })
    .filter((p) => p.size > 0)
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))

  const recentTrades: RecentTrade[] = [...fills]
    .sort((a, b) => b.time - a.time)
    .slice(0, 25)
    .map((f) => ({
      at: f.time,
      market: f.coin,
      action: f.dir,
      size: Number(f.sz),
      price: Number(f.px),
      pnl: Number(f.closedPnl) || null,
    }))

  const flags: CopyFlag[] = []
  if (role.role === "vault") flags.push("vault")
  if (ts.medianHoldSecs !== null && ts.count >= 10 && ts.medianHoldSecs < 300) flags.push("scalper")
  if (ts.perDay !== null && ts.perDay > 40) flags.push("high_frequency")
  if (c.accountValue > 0 && c.vlm.month / c.accountValue > 150) flags.push("market_maker")
  if (tradeCount < 15) flags.push("low_sample")
  if (bestShare !== null && bestShare > 0.6) flags.push("one_big_win")
  const lastFill = fills.reduce((m, f) => Math.max(m, f.time), 0)
  const equityNow = Number(state.marginSummary.accountValue)
  // Nothing traded for a month, or the account has been emptied: there is
  // nothing to copy either way.
  if (!lastFill || Date.now() - lastFill > 30 * 86_400_000 || !(equityNow >= 1_000)) flags.push("inactive")

  const parts = scoreParts({
    roiMonth: c.roi.month,
    roiAll: c.roi.allTime,
    positiveWindows: [c.pnl.week, c.pnl.month, c.pnl.allTime].map((v) => (Number.isFinite(v) ? v > 0 : null)),
    consistencyRatio: cons.ratio,
    activeWeeks: cons.total,
    maxDrawdownPct: dd.pct,
    tradeCount,
    topShare: bestShare,
  })

  const fin = (x: number) => (Number.isFinite(x) ? x : null)
  return {
    venue: "hyperliquid",
    address: c.address,
    displayName: c.displayName,
    accountValue: fin(Number(state.marginSummary.accountValue)) ?? fin(c.accountValue),
    pnl: { day: fin(c.pnl.day), week: fin(c.pnl.week), month: fin(c.pnl.month), all: fin(c.pnl.allTime) },
    roi: { day: fin(c.roi.day), week: fin(c.roi.week), month: fin(c.roi.month), all: fin(c.roi.allTime) },
    volumeMonth: fin(c.vlm.month),
    maxDrawdownPct: dd.pct,
    maxDrawdownAbs: dd.abs,
    profitableWeeks: cons.profitable,
    activeWeeks: cons.total,
    weeklySharpe: weeklySharpe(weekly),
    tradeCount,
    winRate,
    medianHoldSecs: ts.medianHoldSecs,
    tradesPerDay: ts.perDay,
    marketsTraded: new Set(perpFills.map((f) => f.coin)).size,
    topMarkets,
    openPositions,
    recentTrades,
    pnlCurve: downsample(pnlAll),
    score: scoreFrom(parts),
    scoreParts: parts,
    copyable: isCopyable(flags),
    flags,
    refreshedAt: new Date().toISOString(),
  }
}

export async function refreshHyperliquid(opts: {
  limit?: number
  weightPerMinute?: number
  concurrency?: number
  log?: (msg: string) => void
} = {}): Promise<{ profiles: TraderProfile[]; failed: number; candidates: number }> {
  const log = opts.log ?? (() => {})
  const rows = await fetchLeaderboard()
  const candidates = selectCandidates(rows, opts.limit ?? 200)
  log(`[intel/hl] leaderboard ${rows.length} accounts -> ${candidates.length} candidates`)
  const budget = new WeightBudget(opts.weightPerMinute ?? 700)
  const { ok, failed } = await pool(candidates, opts.concurrency ?? 3, (c) => profileHyperliquid(c, budget))
  for (const f of failed.slice(0, 5)) log(`[intel/hl] failed ${f.item.address}: ${f.error}`)
  return { profiles: ok, failed: failed.length, candidates: candidates.length }
}
