/**
 * One copy cycle: for every active follow, plan -> gate -> execute -> ledger.
 *
 * Runs on a timer (the reconciler, docs/01 §2) and immediately after a leader
 * fill arrives over the WebSocket. Target-state planning makes the two
 * equivalent: a missed event is corrected on the next tick.
 *
 * Every follow is isolated — one follow throwing never stops the others, and
 * the error is written to its ledger rather than lost in a log.
 */
import { asMarketId, asTimestamp, money } from "@slipstream/shared"
import type {
  Decimal,
  ExitIntent,
  LeaderRef,
  MarketId,
  SizingMode,
  SkipDecision,
  SubscriptionId,
  TradeIntent,
  UserId,
} from "@slipstream/shared"
import type { Logger } from "@slipstream/shared/log/index.js"
import { plan, STALE_REF_AGE_MS } from "@slipstream/copy"
import { DEFAULT_LIMITS, evaluateAll, type MarketFilter, type RiskContext, type RiskLimits } from "@slipstream/risk"
import { PAPER_COSTS, applyFill, simulateFill, type PaperPosition } from "@slipstream/exec/paper.js"
import type { Book, MarketConstraints, Position } from "@slipstream/venues"
import type { Db } from "@slipstream/db"

import { openLiveKey } from "./keys.js"
import * as store from "./store.js"
import { hl, hlLastFill, hlSnapshot, pmBook, pmLastFills, pmResolution, pmSnapshot, type Snapshot } from "./venues.js"

type Venue = "hyperliquid" | "polymarket"

/** Minimum USD value of a correction (planner tolerance band). */
const TOLERANCE_USD = money.parse("5")
/** Paper follows start from this unless the user chose otherwise. */
export const DEFAULT_PAPER_EQUITY = "10000"
const EXIT_SLIPPAGE_BPS = 300
/** HL's initial per-address action buffer (docs/02 §2). */
const HL_INITIAL_BUDGET = 10_000

export function toSizing(mode: string, param: string): SizingMode {
  const p = money.parse(param)
  switch (mode) {
    case "fixed_notional":
      return { mode: "fixed_notional", notional: p }
    case "percent_equity":
      return { mode: "percent_equity", percent: p }
    case "fixed_multiplier":
      return { mode: "fixed_multiplier", k: p }
    default:
      return { mode: "equity_ratio", multiplier: p }
  }
}

function limitsFrom(venue: Venue, row: Awaited<ReturnType<typeof store.loadRiskProfiles>>[number] | undefined): RiskLimits {
  const base = DEFAULT_LIMITS(venue)
  if (!row) return base
  return {
    ...base,
    maxNotionalPerPosition: money.parse(row.maxNotionalPerPosition),
    maxPositionPctEquity: money.parse(row.maxPositionPctEquity),
    maxTotalExposure: money.parse(row.maxTotalExposure),
    maxLeverage: money.parse(row.maxLeverage),
    maxSlippageBps: row.maxSlippageBps,
    maxSignalAgeMs: row.maxSignalAgeMs,
    maxBookPct: money.parse(row.maxBookPct),
    dailyLossLimit: money.parse(row.dailyLossLimit),
  }
}

const fmt = (d: Decimal | null) => (d === null ? null : money.format(d))

export class CopyEngine {
  /** Skips already written, so a standing condition is logged once, not every tick. */
  private readonly logged = new Map<string, number>()
  private readonly pmFillCache = new Map<string, { at: number; fills: Map<MarketId, LeaderRef> }>()
  public lastCycle: { at: number; follows: number; errors: number } = { at: 0, follows: 0, errors: 0 }

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  async runCycle(venue: Venue): Promise<void> {
    const follows = (await store.loadActiveFollows(this.db)).filter((f) => f.venue === venue)
    if (!follows.length) {
      this.lastCycle = { at: Date.now(), follows: 0, errors: 0 }
      return
    }
    if (venue === "hyperliquid") await hl.warmUp()
    const [kills, profiles, paperRows] = await Promise.all([
      store.loadKillSwitches(this.db),
      store.loadRiskProfiles(this.db, [...new Set(follows.map((f) => f.userId))]),
      store.loadPaperPositions(this.db, follows.filter((f) => f.isPaper).map((f) => f.subscriptionId)),
    ])

    const leaderSnaps = new Map<string, Snapshot | Error>()
    await Promise.all(
      [...new Set(follows.map((f) => f.leaderAddress))].map(async (a) => {
        try {
          leaderSnaps.set(a, venue === "hyperliquid" ? await hlSnapshot(a) : await pmSnapshot(a))
        } catch (e) {
          leaderSnaps.set(a, e instanceof Error ? e : new Error(String(e)))
        }
      }),
    )

    let errors = 0
    for (const f of follows) {
      try {
        const snap = leaderSnaps.get(f.leaderAddress)
        if (!snap || snap instanceof Error) throw snap ?? new Error("leader snapshot missing")
        await this.runFollow(venue, f, snap, kills, profiles.filter((p) => p.userId === f.userId), paperRows)
      } catch (e) {
        errors++
        const msg = e instanceof Error ? e.message : String(e)
        this.log.warn(`copy ${venue} follow ${f.subscriptionId}: ${msg}`.slice(0, 300))
        // Recording the error must never itself escape: if the ledger write
        // fails too (e.g. the user was deleted mid-cycle), one follow would
        // otherwise abort the cycle for every other follow.
        await this.ledgerOnce(`err|${f.subscriptionId}|${msg.slice(0, 80)}`, 15 * 60_000, {
          userId: f.userId,
          subscriptionId: f.subscriptionId,
          venue,
          marketId: "-",
          verdict: "rejected",
          reasonCode: "venue_rejected",
          detail: { problem: msg.slice(0, 300) },
          leaderAddress: f.leaderAddress,
          leaderFillPrice: null,
        }).catch((le) => this.log.warn(`copy ${venue}: could not record error for ${f.subscriptionId}: ${le instanceof Error ? le.message : String(le)}`.slice(0, 200)))
      }
    }
    this.lastCycle = { at: Date.now(), follows: follows.length, errors }
  }

  private async runFollow(
    venue: Venue,
    f: store.ActiveFollow,
    leader: Snapshot,
    kills: store.KillRow[],
    profiles: Awaited<ReturnType<typeof store.loadRiskProfiles>>,
    paperRows: Awaited<ReturnType<typeof store.loadPaperPositions>>,
  ): Promise<void> {
    const now = asTimestamp(Date.now())
    const subKills = kills.filter(
      (k) =>
        k.scope === "global" ||
        (k.scope === "user" && k.scopeId === f.userId) ||
        (k.scope === "subscription" && k.scopeId === f.subscriptionId),
    )
    const kill = {
      global: subKills.some((k) => k.scope === "global"),
      user: subKills.some((k) => k.scope === "user"),
      subscription: subKills.some((k) => k.scope === "subscription"),
    }
    const flatten = subKills.some((k) => k.flatten)

    // Follower state: the paper book, or the live account itself.
    const marks = new Map(leader.marks)
    let followerPositions: Position[]
    let followerEquity: Decimal | null
    if (f.isPaper) {
      const rows = paperRows.filter((r) => r.subscriptionId === f.subscriptionId)
      followerPositions = rows.map((r) => {
        const size = money.parse(r.size)
        const entry = money.parse(r.entryPrice)
        const mark = marks.get(asMarketId(r.marketId)) ?? entry
        const upnl = money.mul(size, r.side === "long" ? money.sub(mark, entry) : money.sub(entry, mark), 10, "trunc")
        return {
          venue,
          marketId: asMarketId(r.marketId),
          side: r.side as "long" | "short",
          size,
          entryPrice: entry,
          notional: money.mul(size, mark, 10, "trunc"),
          unrealizedPnl: upnl,
          leverage: null,
          liquidationPrice: null,
        }
      })
      const start = money.parse(f.startingEquity ?? DEFAULT_PAPER_EQUITY)
      const realized = money.sub(money.parse(f.realizedPnl ?? "0"), money.parse(f.feesPaid ?? "0"))
      const unrealized = followerPositions.reduce((a, p) => money.add(a, p.unrealizedPnl), money.fromInt(0))
      followerEquity = money.add(money.add(start, realized), unrealized)
      await store.markPaperEquity(this.db, f.subscriptionId, money.format(followerEquity))
    } else {
      if (venue !== "hyperliquid") throw new Error("live copy trading is only available on Hyperliquid")
      const own = await hlSnapshot(f.ownerAddress)
      followerPositions = own.positions
      followerEquity = own.equity
      for (const [k, v] of own.marks) if (!marks.has(k)) marks.set(k, v)
    }
    for (const p of followerPositions) {
      if (!marks.has(p.marketId) && !money.isZero(p.size)) marks.set(p.marketId, money.div(money.abs(p.notional), p.size, 10, "trunc"))
    }

    const leaderFills =
      venue === "hyperliquid" ? (hlLastFill.get(f.leaderAddress) ?? new Map<MarketId, LeaderRef>()) : await this.pmFills(f.leaderAddress)

    // Flatten (panic, or stopping this follow): close everything, plan nothing.
    // A follow being stopped is marked stopped once nothing is left open.
    const stopping = subKills.some((k) => k.scope === "subscription" && k.flatten)
    if (flatten && stopping && followerPositions.length === 0) {
      await store.markStopped(this.db, f.subscriptionId)
      return
    }
    if (flatten) {
      for (const p of followerPositions) {
        await this.executeExit(venue, f, {
          kind: "exit",
          id: crypto.randomUUID() as ExitIntent["id"],
          userId: f.userId as UserId,
          subscriptionId: f.subscriptionId as SubscriptionId,
          venue,
          marketId: p.marketId,
          size: null,
          reason: "kill_switch_flatten",
          idempotencyKey: `flatten|${f.subscriptionId}|${p.marketId}|${money.format(p.size)}` as ExitIntent["idempotencyKey"],
          createdAt: now,
        }, followerPositions, leader.labels, marks)
      }
      return
    }

    const planned = plan({
      now,
      userId: f.userId as UserId,
      subscriptionId: f.subscriptionId as SubscriptionId,
      venue,
      sizing: toSizing(f.sizingMode, f.sizingParam),
      leaderPositions: leader.positions,
      followerPositions,
      leaderEquity: leader.equity,
      followerEquity,
      toleranceBand: TOLERANCE_USD,
      markPrices: marks,
      leaderFills,
      leaderAddress: f.leaderAddress as LeaderRef["leaderAddress"],
    })

    for (const exit of planned.exits) await this.executeExit(venue, f, exit, followerPositions, leader.labels, marks)
    for (const skip of planned.skips) if (skip.reason !== "below_tolerance_band") await this.logSkip(f, skip, leader.labels)

    const limits = limitsFrom(venue, profiles.find((p) => p.subscriptionId === f.subscriptionId) ?? profiles.find((p) => p.subscriptionId === null))
    // Positions the leader held before we started watching carry a synthetic
    // reference (planner: now - STALE_REF_AGE_MS). The signal-age gate refuses
    // them by design; logging each one on every tick would bury the ledger, so
    // they become one standing line per follow instead.
    const preexisting: MarketId[] = []
    for (const trade of planned.trades) {
      if (trade.leaderRef && now - trade.leaderRef.leaderFillTs >= STALE_REF_AGE_MS) {
        preexisting.push(trade.marketId)
        continue
      }
      await this.gateAndTrade(venue, f, trade, { limits, kill, followerEquity, followerPositions, labels: leader.labels, marks })
    }
    if (preexisting.length) {
      await this.ledgerOnce(`preexisting|${f.subscriptionId}|${preexisting.length}`, 24 * 3_600_000, {
        userId: f.userId,
        subscriptionId: f.subscriptionId,
        venue,
        marketId: "*",
        verdict: "skipped",
        reasonCode: "signal_stale",
        detail: {
          mode: f.isPaper ? "paper" : "live",
          label: `${preexisting.length} position${preexisting.length === 1 ? "" : "s"} opened before you followed`,
          problem: "Only new moves are copied. Positions the leader already held are not chased at today's prices.",
          markets: preexisting.slice(0, 30).map((m) => leader.labels.get(m) ?? m).join(", "),
        },
        leaderAddress: f.leaderAddress,
        leaderFillPrice: null,
      })
    }
  }

  private async pmFills(address: string): Promise<Map<MarketId, LeaderRef>> {
    const c = this.pmFillCache.get(address)
    if (c && Date.now() - c.at < 20_000) return c.fills
    const fills = await pmLastFills(address)
    this.pmFillCache.set(address, { at: Date.now(), fills })
    return fills
  }

  private async bookFor(venue: Venue, marketId: MarketId): Promise<{ book: Book; constraints: MarketConstraints }> {
    if (venue === "hyperliquid") return { book: await hl.getBook(marketId, 20), constraints: hl.constraints(marketId) }
    return pmBook(marketId)
  }

  private quantize(venue: Venue, marketId: MarketId, side: "buy" | "sell", size: Decimal) {
    if (venue === "hyperliquid") return hl.quantize(marketId, side, null, size)
    const q = money.quantizeToStep(size, money.parse("0.01"), "trunc")
    return { size: q, price: null, belowMinimum: money.isZero(q) }
  }

  private async gateAndTrade(
    venue: Venue,
    f: store.ActiveFollow,
    trade: TradeIntent,
    x: {
      limits: RiskLimits
      kill: RiskContext["kill"]
      followerEquity: Decimal | null
      followerPositions: Position[]
      labels: Map<MarketId, string>
      marks: Map<MarketId, Decimal>
    },
  ) {
    const q = this.quantize(venue, trade.marketId, trade.side, trade.size)
    if (q.belowMinimum) {
      await this.logSkip(f, { ...skipBase(trade), reason: "below_min_notional", detail: { size: money.format(trade.size) } }, x.labels)
      return
    }
    const intent: TradeIntent = { ...trade, size: q.size }
    const { book, constraints } = await this.bookFor(venue, trade.marketId)
    const exposure = x.followerPositions.reduce((a, p) => money.add(a, money.abs(p.notional)), money.fromInt(0))
    const realizedToday = f.isPaper ? money.parse(await store.realizedToday(this.db, f.subscriptionId)) : money.fromInt(0)
    let budget = { remaining: HL_INITIAL_BUDGET, initial: HL_INITIAL_BUDGET }
    if (!f.isPaper && venue === "hyperliquid") {
      const rb = await hl.rateBudget(f.ownerAddress as never)
      budget = { remaining: rb.remaining, initial: Math.max(HL_INITIAL_BUDGET, rb.remaining) }
    }
    const ctx: RiskContext = {
      now: intent.createdAt,
      limits: x.limits,
      marketFilter: (f.marketFilter as MarketFilter | null) ?? { type: "allow_all" },
      kill: x.kill,
      constraints,
      book,
      followerEquity: x.followerEquity,
      followerPositions: x.followerPositions,
      currentExposure: exposure,
      realizedPnlToday: realizedToday,
      rateBudgetRemaining: budget.remaining,
      rateBudgetInitial: budget.initial,
      isPaper: f.isPaper,
    }
    const verdict = evaluateAll(intent, ctx)
    if (!verdict.approved) {
      await this.logSkip(f, verdict.skip, x.labels)
      return
    }
    if (f.isPaper) await this.paperFill(venue, f, intent.marketId, intent.side, intent.size, book, x.labels, { verdict: "copied", leaderRef: intent.leaderRef })
    else await this.liveOrder(f, intent.marketId, intent.side, intent.size, intent.idempotencyKey, false, x.limits.maxSlippageBps, x.labels, intent.leaderRef, "trade", null)
  }

  private async executeExit(
    venue: Venue,
    f: store.ActiveFollow,
    exit: ExitIntent,
    followerPositions: Position[],
    labels: Map<MarketId, string>,
    marks: Map<MarketId, Decimal>,
  ) {
    const pos = followerPositions.find((p) => p.marketId === exit.marketId)
    if (!pos) return
    const size = exit.size === null ? pos.size : money.min(exit.size, pos.size)
    const side = pos.side === "long" ? "sell" : "buy"
    if (f.isPaper) {
      let book: Book | null = null
      try {
        book = (await this.bookFor(venue, exit.marketId)).book
      } catch {
        book = null
      }
      await this.paperFill(venue, f, exit.marketId, side, size, book, labels, { verdict: "exited", reason: exit.reason, fallbackMark: marks.get(exit.marketId) ?? null })
    } else {
      const q = this.quantize(venue, exit.marketId, side, size)
      await this.liveOrder(f, exit.marketId, side, q.size, exit.idempotencyKey, true, EXIT_SLIPPAGE_BPS, labels, null, "exit", exit.reason)
    }
  }

  private async paperFill(
    venue: Venue,
    f: store.ActiveFollow,
    marketId: MarketId,
    side: "buy" | "sell",
    size: Decimal,
    book: Book | null,
    labels: Map<MarketId, string>,
    o: { verdict: "copied" | "exited"; leaderRef?: LeaderRef | null; reason?: string; fallbackMark?: Decimal | null },
  ) {
    let filled = book ? simulateFill(book, side, size, PAPER_COSTS[venue]) : null
    let settled = false
    if ((!filled || filled.avgPrice === null) && o.verdict === "exited" && venue === "polymarket") {
      // No book usually means the market resolved: settle at the payout.
      const payout = await pmResolution(marketId)
      if (payout !== null) {
        filled = { filledSize: size, avgPrice: payout, fee: money.fromInt(0) }
        settled = true
      }
    }
    if (!filled || filled.avgPrice === null || money.isZero(filled.filledSize)) {
      await this.ledgerOnce(`nobook|${f.subscriptionId}|${marketId}|${o.verdict}`, 10 * 60_000, {
        userId: f.userId, subscriptionId: f.subscriptionId, venue, marketId,
        verdict: "rejected", reasonCode: "book_too_thin",
        detail: { label: labels.get(marketId) ?? marketId, problem: "no liquidity on the side this order needs", mode: "paper" },
        leaderAddress: f.leaderAddress, leaderFillPrice: null,
      })
      return
    }
    const rows = await store.loadPaperPositions(this.db, [f.subscriptionId])
    const cur = rows.find((r) => r.marketId === marketId)
    const current: PaperPosition | null = cur
      ? { side: cur.side as "long" | "short", size: money.parse(cur.size), entryPrice: money.parse(cur.entryPrice) }
      : null
    const { position, realizedPnl } = applyFill(current, side, filled.filledSize, filled.avgPrice)
    await store.savePaperPosition(
      this.db,
      f.subscriptionId,
      marketId,
      labels.get(marketId) ?? cur?.label ?? null,
      position ? { side: position.side, size: money.format(position.size), entryPrice: money.format(position.entryPrice) } : null,
    )
    await store.bookRealized(this.db, f.subscriptionId, money.format(realizedPnl), money.format(filled.fee))
    await store.writeLedger(this.db, [
      {
        userId: f.userId, subscriptionId: f.subscriptionId, venue, marketId,
        verdict: o.verdict, reasonCode: null,
        detail: {
          mode: "paper",
          label: labels.get(marketId) ?? cur?.label ?? marketId,
          side,
          size: money.format(filled.filledSize),
          requested: money.format(size),
          avgPrice: money.format(filled.avgPrice),
          fee: money.format(filled.fee),
          realizedPnl: money.format(realizedPnl),
          ...(o.reason ? { exitReason: o.reason } : {}),
          ...(settled ? { settled: "market resolved" } : {}),
          ...(o.leaderRef ? { leaderFillPrice: money.format(o.leaderRef.leaderFillPrice), leaderFillAt: new Date(o.leaderRef.leaderFillTs).toISOString() } : {}),
        },
        leaderAddress: f.leaderAddress,
        leaderFillPrice: fmt(o.leaderRef?.leaderFillPrice ?? null),
      },
    ])
  }

  private async liveOrder(
    f: store.ActiveFollow,
    marketId: MarketId,
    side: "buy" | "sell",
    size: Decimal,
    idempotencyKey: string,
    reduceOnly: boolean,
    slippageBps: number,
    labels: Map<MarketId, string>,
    leaderRef: LeaderRef | null,
    intentKind: "trade" | "exit",
    exitReason: string | null,
  ) {
    const claimed = await store.claimIntent(this.db, {
      id: crypto.randomUUID(),
      userId: f.userId,
      subscriptionId: f.subscriptionId,
      venue: "hyperliquid",
      marketId,
      side,
      size: money.format(size),
      kind: "market",
      intentKind,
      exitReason,
      idempotencyKey,
    })
    if (!claimed) return // already attempted; the venue state is the truth, next cycle re-plans
    let result
    try {
      const key = await openLiveKey(this.db, f)
      result = await hl.placeOrder(key, {
        marketId,
        side,
        size,
        kind: { type: "market", maxSlippageBps: slippageBps },
        reduceOnly,
        clientId: idempotencyKey as never,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await store.settleIntent(this.db, idempotencyKey, { status: "rejected", venueOrderId: null, rejectReason: msg.slice(0, 300) })
      throw e
    }
    await store.settleIntent(this.db, idempotencyKey, {
      status: result.status,
      venueOrderId: result.venueOrderId,
      rejectReason: result.rejectReason,
    })
    const ok = result.status === "filled" || result.status === "partial"
    await store.writeLedger(this.db, [
      {
        userId: f.userId, subscriptionId: f.subscriptionId, venue: "hyperliquid", marketId,
        verdict: ok ? (intentKind === "exit" ? "exited" : "copied") : "rejected",
        reasonCode: ok ? null : "venue_rejected",
        detail: {
          mode: "live",
          label: labels.get(marketId) ?? `${marketId} perp`,
          side,
          size: money.format(result.filledSize),
          requested: money.format(size),
          avgPrice: fmt(result.avgPrice),
          status: result.status,
          ...(result.rejectReason ? { problem: result.rejectReason } : {}),
          ...(exitReason ? { exitReason } : {}),
        },
        leaderAddress: f.leaderAddress,
        leaderFillPrice: fmt(leaderRef?.leaderFillPrice ?? null),
      },
    ])
  }

  private async logSkip(f: store.ActiveFollow, s: SkipDecision, labels: Map<MarketId, string>) {
    const key = `skip|${f.subscriptionId}|${s.marketId}|${s.reason}|${s.leaderRef?.leaderFillTs ?? ""}`
    await this.ledgerOnce(key, 6 * 3_600_000, {
      userId: f.userId,
      subscriptionId: f.subscriptionId,
      venue: s.venue,
      marketId: s.marketId,
      verdict: "skipped",
      reasonCode: s.reason,
      detail: { mode: f.isPaper ? "paper" : "live", label: labels.get(s.marketId) ?? s.marketId, ...s.detail },
      leaderAddress: s.leaderRef?.leaderAddress ?? f.leaderAddress,
      leaderFillPrice: fmt(s.leaderRef?.leaderFillPrice ?? null),
    })
  }

  private async ledgerOnce(key: string, ttlMs: number, entry: store.LedgerEntry) {
    const at = this.logged.get(key)
    if (at !== undefined && Date.now() - at < ttlMs) return
    this.logged.set(key, Date.now())
    if (this.logged.size > 20_000) {
      for (const [k, t] of this.logged) if (Date.now() - t > 6 * 3_600_000) this.logged.delete(k)
    }
    await store.writeLedger(this.db, [entry])
  }
}

function skipBase(t: TradeIntent): SkipDecision {
  return {
    kind: "skip",
    userId: t.userId,
    subscriptionId: t.subscriptionId,
    venue: t.venue,
    marketId: t.marketId,
    reason: "below_min_notional",
    detail: {},
    leaderRef: t.leaderRef,
    createdAt: t.createdAt,
  }
}
