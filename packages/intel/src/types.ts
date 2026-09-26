export type IntelVenue = "hyperliquid" | "polymarket"

export interface WindowPnl {
  readonly day: number | null
  readonly week: number | null
  readonly month: number | null
  readonly all: number | null
}

/** Why a wallet is hard or impossible to copy. Shown verbatim in the UI. */
export type CopyFlag =
  | "scalper" // median hold under a few minutes: gone before a copy lands
  | "high_frequency" // dozens of round trips a day
  | "market_maker" // turnover so high relative to equity that it is inventory, not views
  | "short_horizon_markets" // Polymarket: mostly 5/15-minute "up or down" markets
  | "low_sample" // too few closed trades to say anything
  | "one_big_win" // most of the profit came from a single trade/market
  | "inactive" // nothing in the last 30 days
  | "vault" // a Hyperliquid vault, not a trader

export interface ScoreParts {
  /** 0..1 each. The score is a documented weighting of these, nothing hidden. */
  readonly profitability: number
  readonly consistency: number
  readonly risk: number
  readonly sample: number
  /** multiplier <= 1 applied for concentration */
  readonly concentrationPenalty: number
}

export interface TraderProfile {
  readonly venue: IntelVenue
  readonly address: string
  readonly displayName: string | null
  /** Account value (HL) or portfolio value incl. open positions (PM), USD. */
  readonly accountValue: number | null
  readonly pnl: WindowPnl
  readonly roi: WindowPnl
  readonly volumeMonth: number | null
  readonly maxDrawdownPct: number | null
  readonly maxDrawdownAbs: number | null
  readonly profitableWeeks: number | null
  readonly activeWeeks: number | null
  readonly weeklySharpe: number | null
  /** HL: closed round trips in the fetched fill window. PM: closed positions. */
  readonly tradeCount: number
  readonly winRate: number | null
  readonly medianHoldSecs: number | null
  readonly tradesPerDay: number | null
  readonly marketsTraded: number | null
  readonly topMarkets: readonly { readonly name: string; readonly share: number }[]
  readonly openPositions: readonly OpenPosition[]
  readonly recentTrades: readonly RecentTrade[]
  /** Cumulative PnL series for the profile chart, downsampled. [epoch ms, usd] */
  readonly pnlCurve: readonly (readonly [number, number])[]
  readonly score: number
  readonly scoreParts: ScoreParts
  readonly copyable: boolean
  readonly flags: readonly CopyFlag[]
  readonly refreshedAt: string
}

export interface OpenPosition {
  readonly market: string
  /** "long"/"short" on HL, the outcome name ("Yes", "Trump", ...) on PM */
  readonly side: string
  readonly size: number
  readonly entryPrice: number | null
  readonly markPrice: number | null
  readonly valueUsd: number | null
  readonly unrealizedPnl: number | null
  readonly leverage: number | null
  readonly url: string | null
}

export interface RecentTrade {
  readonly at: number
  readonly market: string
  readonly action: string
  readonly size: number
  readonly price: number
  readonly pnl: number | null
}
