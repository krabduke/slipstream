/**
 * The risk gate.
 *
 * Every gate accepts `TradeIntent` and ONLY `TradeIntent`. `ExitIntent` is a
 * different type and is never passed here — that is the mechanism enforcing
 * "entries are gated, exits never are" (docs/03 §5). W14's test suite must
 * include a test proving no gate can reject an exit.
 *
 * Gates run in the declared order and short-circuit on first failure.
 */
import type {
  Decimal,
  ReasonCode,
  SkipDecision,
  TradeIntent,
} from "@slipstream/shared"
import type { Book, MarketConstraints, Position } from "@slipstream/venues"
import type { Timestamp } from "@slipstream/shared"

export interface RiskLimits {
  readonly maxNotionalPerPosition: Decimal
  readonly maxPositionPctEquity: Decimal
  readonly maxTotalExposure: Decimal
  readonly maxLeverage: Decimal
  readonly maxSlippageBps: number
  readonly maxSignalAgeMs: number
  readonly maxBookPct: Decimal
  readonly dailyLossLimit: Decimal
  /** Fraction of the venue action budget held in reserve. */
  readonly rateBudgetReserve: Decimal
}

export type MarketFilter =
  | { readonly type: "allow_all" }
  | { readonly type: "allowlist"; readonly markets: readonly string[] }
  | { readonly type: "blocklist"; readonly markets: readonly string[] }

export interface KillState {
  readonly global: boolean
  readonly user: boolean
  readonly subscription: boolean
}

/** Everything a gate is allowed to look at. Gates are pure functions of this —
 *  no I/O, no clock reads, no venue calls. That is what makes them testable. */
export interface RiskContext {
  readonly now: Timestamp
  readonly limits: RiskLimits
  readonly marketFilter: MarketFilter
  readonly kill: KillState
  readonly constraints: MarketConstraints
  readonly book: Book
  readonly followerEquity: Decimal | null
  readonly followerPositions: readonly Position[]
  readonly currentExposure: Decimal
  readonly realizedPnlToday: Decimal
  readonly rateBudgetRemaining: number
  readonly rateBudgetInitial: number
  readonly isPaper: boolean
}

export type GateVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: ReasonCode
      readonly detail: Readonly<Record<string, string>>
    }

export interface Gate {
  readonly name: string
  /** Note the parameter type. There is no overload taking an ExitIntent, and
   *  adding one would be a deliberate act contradicting docs/03 §5. */
  evaluate(intent: TradeIntent, ctx: RiskContext): GateVerdict
}

export type GateResult =
  | { readonly approved: true; readonly intent: TradeIntent }
  | { readonly approved: false; readonly skip: SkipDecision }
