/** The account-wide limits a user can edit, in display units. */
export interface EditableLimits {
  perPositionUsd: number
  perPositionPct: number
  exposurePct: number
  leverage: number
  dailyLossPct: number
}

/** docs/03 §4 defaults. */
export const DEFAULTS: EditableLimits = { perPositionUsd: 1000, perPositionPct: 20, exposurePct: 50, leverage: 3, dailyLossPct: 10 }

export const RANGES: Record<keyof EditableLimits, [number, number]> = {
  perPositionUsd: [10, 1_000_000],
  perPositionPct: [1, 100],
  exposurePct: [5, 300],
  leverage: [1, 20],
  dailyLossPct: [1, 50],
}

/** True when any value takes on more risk than the current one. */
export function loosens(next: EditableLimits, current: EditableLimits): boolean {
  return (Object.keys(next) as (keyof EditableLimits)[]).some((k) => next[k] > current[k])
}

/** Converts a stored risk profile (fractions as strings) to display units. */
export function fromRow(r: { maxNotionalPerPosition: string; maxPositionPctEquity: string; maxTotalExposure: string; maxLeverage: string; dailyLossLimit: string } | undefined): EditableLimits {
  if (!r) return DEFAULTS
  return {
    perPositionUsd: Number(r.maxNotionalPerPosition),
    perPositionPct: Number(r.maxPositionPctEquity) * 100,
    exposurePct: Number(r.maxTotalExposure) * 100,
    leverage: Number(r.maxLeverage),
    dailyLossPct: Number(r.dailyLossLimit) * 100,
  }
}
