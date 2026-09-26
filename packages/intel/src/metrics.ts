/**
 * Trader statistics — pure functions, no I/O.
 *
 * This is analytics for humans deciding whom to study, never an input to an
 * order. It therefore uses plain `number` deliberately: the float ban in
 * docs/02 §5 covers every path that touches an order (money/, venues/), and
 * nothing here does. If a value from this file ever needs to size a trade, it
 * must be re-derived from venue strings through @slipstream/shared/money.
 *
 * Every statistic is computed to be pessimistic rather than flattering
 * (docs/05 §3): drawdown uses realised + marked PnL, open round-trips are
 * excluded from win rate rather than counted as wins, and a round-trip whose
 * opening fill falls before the fetched window is dropped instead of guessed.
 */

export interface Point {
  /** epoch milliseconds */
  readonly t: number
  readonly v: number
}

/**
 * Largest peak-to-trough fall of a cumulative-PnL series, in absolute terms,
 * and relative to the capital that was at risk at the peak.
 *
 * Relative drawdown divides by `capitalAt(peakTime)` (account value at the
 * peak) when provided, because a PnL series alone has no denominator: a $50k
 * fall is a disaster on a $60k account and noise on a $60M one.
 */
export function maxDrawdown(
  pnl: readonly Point[],
  capitalAt?: (t: number) => number | undefined,
): { abs: number; pct: number | null } {
  let peak = -Infinity
  let peakT = 0
  let worstAbs = 0
  let worstPct: number | null = null
  for (const p of pnl) {
    if (p.v > peak) {
      peak = p.v
      peakT = p.t
    }
    const fall = peak - p.v
    if (fall > worstAbs) worstAbs = fall
    if (capitalAt && fall > 0) {
      const cap = capitalAt(peakT)
      if (cap !== undefined && cap > 0) {
        const pct = fall / cap
        if (worstPct === null || pct > worstPct) worstPct = pct
      }
    }
  }
  if (capitalAt && worstPct === null) worstPct = 0
  return { abs: worstAbs, pct: worstPct }
}

/**
 * Time-weighted return index from paired account-value and cumulative-PnL
 * histories. Each interval's return is the PnL earned in it divided by the
 * equity at its start, so deposits and withdrawals (which move account value
 * but not PnL) cancel out. Intervals starting below `minCapital` are skipped:
 * a $3 account that makes $30 is not a 1,000% trader.
 *
 * Returns the compounded index (starting at 1) and its max drawdown.
 */
export function timeWeighted(
  equity: readonly Point[],
  pnl: readonly Point[],
  minCapital = 1_000,
): { index: Point[]; totalReturn: number | null; maxDrawdown: number | null } {
  const n = Math.min(equity.length, pnl.length)
  if (n < 2) return { index: [], totalReturn: null, maxDrawdown: null }
  let level = 1
  let peak = 1
  let worst = 0
  let counted = 0
  const index: Point[] = [{ t: pnl[0]!.t, v: 1 }]
  for (let i = 1; i < n; i++) {
    const earned = pnl[i]!.v - pnl[i - 1]!.v
    // Capital actually deployed in the interval: the larger of the starting
    // equity and the ending equity net of this interval's PnL. The second
    // term counts money deposited during the interval; without it a $1k
    // account that deposits $90k and loses $10k reads as -1,000%. Histories
    // are coarse (all-time points are weeks apart), so this matters.
    const cap = Math.max(equity[i - 1]!.v, equity[i]!.v - earned)
    if (cap >= minCapital) {
      const r = Math.max(-0.99, earned / cap)
      level *= 1 + r
      counted++
      if (level > peak) peak = level
      const dd = (peak - level) / peak
      if (dd > worst) worst = dd
    }
    index.push({ t: pnl[i]!.t, v: level })
  }
  return counted ? { index, totalReturn: level - 1, maxDrawdown: worst } : { index: [], totalReturn: null, maxDrawdown: null }
}

/**
 * Outcome stats from closing orders, for accounts that never go fully flat
 * (large traders scale in and out, so flat-to-flat round trips are rare).
 * Each closing order's realised PnL, net of the fees on that order, is one
 * outcome.
 */
export function closingOrderStats(
  fills: readonly { oid: number; coin: string; closedPnl: number; fee: number; time: number }[],
): { count: number; winRate: number | null; bestShare: number | null } {
  const byOrder = new Map<number, number>()
  for (const f of fills) {
    if (f.closedPnl === 0) continue
    byOrder.set(f.oid, (byOrder.get(f.oid) ?? 0) + f.closedPnl - f.fee)
  }
  const outcomes = [...byOrder.values()]
  if (!outcomes.length) return { count: 0, winRate: null, bestShare: null }
  const gains = outcomes.filter((o) => o > 0)
  const gross = gains.reduce((a, b) => a + b, 0)
  return {
    count: outcomes.length,
    winRate: gains.length / outcomes.length,
    bestShare: gross > 0 ? Math.max(...gains) / gross : null,
  }
}

/** Step-function lookup: the last value at or before `t`. */
export function valueAt(series: readonly Point[], t: number): number | undefined {
  let lo = 0
  let hi = series.length - 1
  let ans: number | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const p = series[mid]!
    if (p.t <= t) {
      ans = p.v
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans ?? series[0]?.v
}

const WEEK_MS = 7 * 24 * 3600 * 1000

/**
 * PnL change per calendar week (UTC, Monday-aligned) of a cumulative series.
 * A week counts only if the series has a point inside it, so dormant weeks
 * neither help nor hurt consistency.
 */
export function weeklyChanges(cumulative: readonly Point[]): number[] {
  if (cumulative.length < 2) return []
  const monday = (t: number) => {
    const d = new Date(t)
    const day = (d.getUTCDay() + 6) % 7
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)
  }
  const lastByWeek = new Map<number, number>()
  for (const p of cumulative) lastByWeek.set(monday(p.t), p.v)
  const weeks = [...lastByWeek.entries()].sort((a, b) => a[0] - b[0])
  const out: number[] = []
  let prev = cumulative[0]!.v
  for (const [, v] of weeks) {
    out.push(v - prev)
    prev = v
  }
  // The first bucket measures from the series' own first point, which is
  // usually mid-week; keep it only if the series spans more than that week.
  return weeks.length > 1 ? out : out.slice(0, 1)
}

export function consistency(changes: readonly number[]): { profitable: number; total: number; ratio: number | null } {
  const active = changes.filter((c) => c !== 0)
  const profitable = active.filter((c) => c > 0).length
  return { profitable, total: active.length, ratio: active.length ? profitable / active.length : null }
}

/** Mean / sample standard deviation of weekly changes. Null below 4 weeks. */
export function weeklySharpe(changes: readonly number[]): number | null {
  if (changes.length < 4) return null
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length
  const variance = changes.reduce((a, b) => a + (b - mean) ** 2, 0) / (changes.length - 1)
  const sd = Math.sqrt(variance)
  return sd === 0 ? null : mean / sd
}

// ── Round trips (Hyperliquid perps) ──────────────────────────────────────────

/** The subset of a Hyperliquid `userFills` row these statistics read. */
export interface PerpFill {
  readonly coin: string
  readonly time: number
  /** signed position before this fill */
  readonly startPosition: number
  /** signed size change: + for buys, - for sells */
  readonly delta: number
  readonly closedPnl: number
  readonly fee: number
}

export interface RoundTrip {
  readonly coin: string
  readonly openedAt: number
  readonly closedAt: number
  readonly pnl: number
}

/**
 * Reconstruct flat-to-flat round trips per coin. A position flip (long to
 * short in one fill) closes one trip and opens the next at the same instant.
 * Trips whose opening fill predates the fetched window are dropped: their
 * entry, and so their PnL and hold time, is unknown.
 */
export function roundTrips(fills: readonly PerpFill[]): RoundTrip[] {
  const byCoin = new Map<string, PerpFill[]>()
  for (const f of fills) {
    const arr = byCoin.get(f.coin)
    if (arr) arr.push(f)
    else byCoin.set(f.coin, [f])
  }
  const eps = 1e-12
  const trips: RoundTrip[] = []
  for (const [coin, list] of byCoin) {
    list.sort((a, b) => a.time - b.time)
    let open: { at: number; pnl: number } | null = null
    let seenFlat = false
    for (const f of list) {
      const before = f.startPosition
      const after = before + f.delta
      if (Math.abs(before) < eps) seenFlat = true
      if (open) open.pnl += f.closedPnl - f.fee
      const closes = Math.abs(before) > eps && (Math.abs(after) < eps || Math.sign(after) !== Math.sign(before))
      if (closes && open) {
        trips.push({ coin, openedAt: open.at, closedAt: f.time, pnl: open.pnl })
        open = null
      }
      const opens = Math.abs(after) > eps && (Math.abs(before) < eps || Math.sign(after) !== Math.sign(before))
      if (opens && seenFlat) {
        // Opening from flat: the entry fee is a cost of this trip. On a flip,
        // the fill's closedPnl and fee were already booked to the trip that
        // just closed, so the new trip starts clean.
        const fromFlat = Math.abs(before) < eps
        open = { at: f.time, pnl: fromFlat ? -f.fee : 0 }
      }
      if (Math.abs(after) < eps) seenFlat = true
    }
  }
  return trips.sort((a, b) => a.closedAt - b.closedAt)
}

export interface TripStats {
  readonly count: number
  readonly winRate: number | null
  readonly medianHoldSecs: number | null
  readonly avgHoldSecs: number | null
  readonly perDay: number | null
  readonly bestTripShare: number | null
}

export function tripStats(trips: readonly RoundTrip[]): TripStats {
  if (!trips.length) {
    return { count: 0, winRate: null, medianHoldSecs: null, avgHoldSecs: null, perDay: null, bestTripShare: null }
  }
  const holds = trips.map((t) => (t.closedAt - t.openedAt) / 1000).sort((a, b) => a - b)
  const wins = trips.filter((t) => t.pnl > 0).length
  const span = (trips[trips.length - 1]!.closedAt - trips[0]!.openedAt) / 86_400_000
  const gains = trips.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0)
  const best = Math.max(0, ...trips.map((t) => t.pnl))
  return {
    count: trips.length,
    winRate: wins / trips.length,
    medianHoldSecs: holds[Math.floor(holds.length / 2)]!,
    avgHoldSecs: holds.reduce((a, b) => a + b, 0) / holds.length,
    perDay: span > 0 ? trips.length / span : null,
    bestTripShare: gains > 0 ? best / gains : null,
  }
}
