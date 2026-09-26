/**
 * The skill score: one number, fully decomposed.
 *
 * Raw leaderboards rank by PnL, which rewards size and luck. A $60M account
 * that made 0.3% outranks a $50k account that doubled, and a wallet that hit
 * one lottery ticket outranks one that has been right forty weeks out of fifty.
 * This score asks a narrower question: how much evidence is there that this
 * wallet is repeatably good at what it does, at a risk you could stomach?
 *
 *   score = 100 x (0.35 profitability + 0.30 consistency + 0.25 risk + 0.10 sample)
 *                x concentration penalty
 *
 * Every part is shown on the profile page. It is a statistic, not advice:
 * nothing here predicts what the wallet does next (docs/04 §7).
 */
import type { CopyFlag, ScoreParts } from "./types.js"

export const WEIGHTS = { profitability: 0.35, consistency: 0.3, risk: 0.25, sample: 0.1 } as const

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0)

/**
 * Return-on-equity mapped to 0..1 with diminishing credit: 0% -> 0.5 would
 * reward merely not losing, so the curve is anchored at 0 for 0% and
 * saturates around +100%. Losses map to 0.
 */
export function roiCredit(roi: number | null): number {
  if (roi === null || roi <= 0) return 0
  return clamp01(1 - Math.exp(-roi / 0.4))
}

export interface ScoreInput {
  readonly roiMonth: number | null
  readonly roiAll: number | null
  /** true where that window's PnL is positive; null windows are ignored */
  readonly positiveWindows: readonly (boolean | null)[]
  readonly consistencyRatio: number | null
  readonly activeWeeks: number | null
  readonly maxDrawdownPct: number | null
  readonly tradeCount: number
  /** share of gross profit from the single best trade/market, 0..1 */
  readonly topShare: number | null
}

export function scoreParts(i: ScoreInput): ScoreParts {
  const windows = i.positiveWindows.filter((w): w is boolean => w !== null)
  const windowCredit = windows.length ? windows.filter(Boolean).length / windows.length : 0
  const profitability = clamp01(0.4 * roiCredit(i.roiAll) + 0.3 * roiCredit(i.roiMonth) + 0.3 * windowCredit)

  // Consistency is only trusted after enough weeks; below 8 it is shrunk
  // toward 0.5 (no information) so a two-week hot streak cannot max it out.
  const weeks = i.activeWeeks ?? 0
  const raw = i.consistencyRatio ?? 0.5
  const trust = clamp01(weeks / 8)
  const consistency = clamp01(trust * raw + (1 - trust) * 0.5 * raw)

  // 0% drawdown -> 1, 50%+ -> 0. Unknown drawdown is treated as bad, not good.
  const risk = i.maxDrawdownPct === null ? 0.3 : clamp01(1 - i.maxDrawdownPct / 0.5)

  const sample = clamp01(i.tradeCount / 60)

  const concentrationPenalty =
    i.topShare === null ? 1 : i.topShare > 0.6 ? 0.6 : i.topShare > 0.4 ? 0.8 : 1

  return { profitability, consistency, risk, sample, concentrationPenalty }
}

export function scoreFrom(p: ScoreParts): number {
  const base =
    WEIGHTS.profitability * p.profitability +
    WEIGHTS.consistency * p.consistency +
    WEIGHTS.risk * p.risk +
    WEIGHTS.sample * p.sample
  return Math.round(100 * base * p.concentrationPenalty)
}

/** Flags that make a wallet impractical to copy. Any of these -> not copyable. */
export const BLOCKING_FLAGS: ReadonlySet<CopyFlag> = new Set<CopyFlag>([
  "scalper",
  "high_frequency",
  "market_maker",
  "short_horizon_markets",
  "vault",
  "inactive",
])

export function isCopyable(flags: readonly CopyFlag[]): boolean {
  return !flags.some((f) => BLOCKING_FLAGS.has(f))
}
