/**
 * Fixtures for the risk-gate tests.
 *
 * The numbers are the ones from the ledger example in docs/03 §7 — a leader
 * filling BTC at 64,210 while the best ask has already run to 64,769, which is
 * 87 bps of slippage against a 50 bps limit. Using the documented scenario
 * means the tests fail if the documented behaviour ever stops being true.
 */
import { expect } from "vitest"
import { asMarketId, asTimestamp, money } from "@slipstream/shared"
import type {
  Decimal,
  ExitIntent,
  IdempotencyKey,
  IntentId,
  LeaderRef,
  MarketId,
  SubscriptionId,
  TradeIntent,
  UserId,
} from "@slipstream/shared"
import type { Book, BookLevel, MarketConstraints, Position } from "@slipstream/venues"
import type { GateVerdict, RiskContext, RiskLimits } from "../types.js"
import { DEFAULT_LIMITS } from "../defaults.js"

export const d = (s: string, scale?: number): Decimal => money.parse(s, scale)

/** Sizes carry four places, prices one — the Hyperliquid BTC grid. */
export const size = (s: string): Decimal => d(s, 4)
export const price = (s: string): Decimal => d(s, 1)
export const usd = (s: string): Decimal => d(s, 2)

export const NOW = asTimestamp(1_700_000_000_000)
export const BTC = asMarketId("BTC")
export const ETH = asMarketId("ETH")

export const USER = "user-1" as UserId
export const SUBSCRIPTION = "sub-1" as SubscriptionId
export const LEADER = "0x7a3f000000000000000000000000000000000000" as LeaderRef["leaderAddress"]

export const level = (p: string, s: string): BookLevel => ({ price: price(p), size: size(s) })

export const makeBook = (over: Partial<Book> = {}): Book => ({
  marketId: BTC,
  asks: [level("64210.0", "100"), level("64250.0", "100")],
  bids: [level("64190.0", "100"), level("64150.0", "100")],
  ts: NOW,
  ...over,
})

export const makeConstraints = (over: Partial<MarketConstraints> = {}): MarketConstraints => ({
  priceTick: price("0.1"),
  sizeLot: size("0.0001"),
  minNotional: usd("10.00"),
  maxLeverage: d("50", 2),
  supportsShort: true,
  supportsReduceOnly: true,
  ...over,
})

export const makeLimits = (over: Partial<RiskLimits> = {}): RiskLimits => ({
  ...DEFAULT_LIMITS("hyperliquid"),
  ...over,
})

export const makeLeaderRef = (over: Partial<LeaderRef> = {}): LeaderRef => ({
  leaderAddress: LEADER,
  leaderFillPrice: price("64200.0"),
  leaderFillTs: asTimestamp(NOW - 1000),
  ...over,
})

export const makePosition = (over: Partial<Position> = {}): Position => ({
  venue: "hyperliquid",
  marketId: BTC,
  side: "long",
  size: size("0.05"),
  entryPrice: price("64000.0"),
  notional: usd("3200.00"),
  unrealizedPnl: usd("0.00"),
  leverage: d("2", 2),
  liquidationPrice: price("32000.0"),
  ...over,
})

/** A 0.01 BTC buy: small enough that every default cap passes, so any test
 *  that sees a rejection has caused it deliberately. */
export const makeIntent = (over: Partial<TradeIntent> = {}): TradeIntent => ({
  kind: "trade",
  id: "intent-1" as IntentId,
  userId: USER,
  subscriptionId: SUBSCRIPTION,
  venue: "hyperliquid",
  marketId: BTC,
  side: "buy",
  size: size("0.01"),
  limitPrice: null,
  idempotencyKey: "idem-1" as IdempotencyKey,
  leaderRef: makeLeaderRef(),
  createdAt: NOW,
  ...over,
})

export const makeCtx = (over: Partial<RiskContext> = {}): RiskContext => ({
  now: NOW,
  limits: makeLimits(),
  marketFilter: { type: "allow_all" },
  kill: { global: false, user: false, subscription: false },
  constraints: makeConstraints(),
  book: makeBook(),
  followerEquity: usd("10000.00"),
  followerPositions: [],
  currentExposure: usd("0.00"),
  realizedPnlToday: usd("0.00"),
  rateBudgetRemaining: 100,
  rateBudgetInitial: 100,
  isPaper: false,
  ...over,
})

/** Only ever used to prove it cannot be passed to a gate. */
export const makeExit = (over: Partial<ExitIntent> = {}): ExitIntent => ({
  kind: "exit",
  id: "intent-2" as IntentId,
  userId: USER,
  subscriptionId: SUBSCRIPTION,
  venue: "hyperliquid",
  marketId: BTC,
  size: null,
  reason: "leader_closed",
  idempotencyKey: "idem-2" as IdempotencyKey,
  createdAt: NOW,
  ...over,
})

export const marketId = (s: string): MarketId => asMarketId(s)

/** Narrow a verdict to its rejection, failing loudly if it passed. Keeps every
 *  assertion below about the reason and the numbers rather than about types. */
export const rejection = (
  verdict: GateVerdict,
): { readonly reason: string; readonly detail: Readonly<Record<string, string>> } => {
  expect(verdict.ok, "expected a rejection, got a pass").toBe(false)
  if (verdict.ok) throw new Error("unreachable: verdict passed")
  return { reason: verdict.reason, detail: verdict.detail }
}

export const expectPass = (verdict: GateVerdict): void => {
  expect(verdict).toEqual({ ok: true })
}
