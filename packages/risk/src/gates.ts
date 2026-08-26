/** W14 — the gates, in evaluation order. Contract: ./types.ts
 *  Note: `evaluate` accepts TradeIntent only. Exits are never gated. */
import { notImplemented } from "@slipstream/shared/notimpl.js"
import type { SkipDecision, TradeIntent } from "@slipstream/shared"
import type { Gate, GateResult, RiskContext } from "./types.js"

export const GATES: readonly Gate[] = []

export const evaluateAll = (_intent: TradeIntent, _ctx: RiskContext): GateResult =>
  notImplemented("W14", "evaluateAll")

export type { SkipDecision }
