/**
 * What the copy loop needs from each venue, behind one shape:
 * leader and follower snapshots, recent leader fills, books, constraints.
 *
 * Hyperliquid goes through the existing VenueAdapter. Polymarket is read-only
 * here (paper trading and alerts): trading it is geoblocked for this host and
 * its operator, so no write path exists.
 */
import { asMarketId, asTimestamp, money } from "@slipstream/shared"
import type { Address, Decimal, LeaderRef, MarketId } from "@slipstream/shared"
import { createHyperliquidAdapter } from "@slipstream/venues/hyperliquid/index.js"
import type { Book, MarketConstraints, Position } from "@slipstream/venues"

export interface Snapshot {
  positions: Position[]
  equity: Decimal | null
  marks: Map<MarketId, Decimal>
  labels: Map<MarketId, string>
}

export const hl = createHyperliquidAdapter()

const markOf = (p: Position): Decimal | null =>
  money.isZero(p.size) ? null : money.div(money.abs(p.notional), p.size, 10, "trunc")

export async function hlSnapshot(address: string): Promise<Snapshot> {
  const [positions, equity] = await Promise.all([
    hl.getPositions(address as Address),
    hl.getAccountValue(address as Address).catch(() => null),
  ])
  const marks = new Map<MarketId, Decimal>()
  for (const p of positions) {
    const m = markOf(p)
    if (m) marks.set(p.marketId, m)
  }
  return { positions: [...positions], equity, marks, labels: new Map(positions.map((p) => [p.marketId, `${p.marketId} perp`])) }
}

/** Latest fill per leader per market, fed by the WebSocket watcher. */
export const hlLastFill = new Map<string, Map<MarketId, LeaderRef>>()

// ── Polymarket (read-only) ─────────────────────────────────────────────────

const DATA = "https://data-api.polymarket.com"
const CLOB = "https://clob.polymarket.com"
const GAMMA = "https://gamma-api.polymarket.com"

async function getJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}${new URL(url).pathname}`)
    return (await r.json()) as T
  } finally {
    clearTimeout(t)
  }
}

interface PmPos {
  asset: string
  size: number
  avgPrice: number
  currentValue: number
  cashPnl: number
  curPrice: number
  redeemable: boolean
  title: string
  outcome: string
}

/** Venue numbers arrive as JSON numbers; go through the string form, never float math. */
const dec = (x: number | string) => money.parse(typeof x === "number" ? x.toString() : x)

export async function pmSnapshot(address: string): Promise<Snapshot> {
  const [rows, value] = await Promise.all([
    getJson<PmPos[]>(`${DATA}/positions?user=${address}&limit=500&sizeThreshold=0.1`),
    getJson<{ value: number }[]>(`${DATA}/value?user=${address}`).catch(() => []),
  ])
  const positions: Position[] = []
  const marks = new Map<MarketId, Decimal>()
  const labels = new Map<MarketId, string>()
  for (const r of rows) {
    // A redeemable position has resolved; it is no longer a view to copy.
    if (r.redeemable || !(r.size > 0)) continue
    const id = asMarketId(r.asset)
    positions.push({
      venue: "polymarket",
      marketId: id,
      side: "long",
      size: dec(r.size),
      entryPrice: dec(r.avgPrice),
      notional: dec(r.currentValue),
      unrealizedPnl: dec(r.cashPnl),
      leverage: null,
      liquidationPrice: null,
    })
    marks.set(id, dec(r.curPrice))
    labels.set(id, `${r.title} — ${r.outcome}`)
  }
  const v = value[0]?.value
  return { positions, equity: v === undefined ? null : dec(v), marks, labels }
}

interface PmActivity {
  type: string
  asset: string
  price: number
  timestamp: number
}

/** Most recent trade per outcome token, as leader refs for the gates. */
export async function pmLastFills(address: string): Promise<Map<MarketId, LeaderRef>> {
  const rows = await getJson<PmActivity[]>(`${DATA}/activity?user=${address}&type=TRADE&limit=100`)
  const out = new Map<MarketId, LeaderRef>()
  for (const r of rows) {
    const id = asMarketId(r.asset)
    const ts = r.timestamp * 1000
    const prev = out.get(id)
    if (!prev || prev.leaderFillTs < ts) {
      out.set(id, { leaderAddress: address.toLowerCase() as Address, leaderFillPrice: dec(r.price), leaderFillTs: asTimestamp(ts) })
    }
  }
  return out
}

interface ClobBook {
  bids: { price: string; size: string }[]
  asks: { price: string; size: string }[]
  tick_size?: string
  min_order_size?: string
}

export async function pmBook(tokenId: MarketId): Promise<{ book: Book; constraints: MarketConstraints }> {
  const b = await getJson<ClobBook>(`${CLOB}/book?token_id=${tokenId}`)
  const lv = (xs: { price: string; size: string }[]) => xs.map((x) => ({ price: money.parse(x.price), size: money.parse(x.size) }))
  return {
    book: { marketId: tokenId, bids: lv(b.bids), asks: lv(b.asks), ts: asTimestamp(Date.now()) },
    constraints: {
      priceTick: money.parse(b.tick_size ?? "0.01"),
      sizeLot: money.parse("0.01"),
      minNotional: money.parse("1"),
      maxLeverage: money.parse("1"),
      supportsShort: false,
      supportsReduceOnly: false,
    },
  }
}

/** For a paper position in a market that has resolved: the payout per share. */
export async function pmResolution(tokenId: MarketId): Promise<Decimal | null> {
  const markets = await getJson<{ closed: boolean; clobTokenIds: string; outcomePrices: string }[]>(
    `${GAMMA}/markets?clob_token_ids=${tokenId}`,
  ).catch(() => [])
  const m = markets[0]
  if (!m || !m.closed) return null
  const ids = JSON.parse(m.clobTokenIds) as string[]
  const prices = JSON.parse(m.outcomePrices) as string[]
  const i = ids.indexOf(tokenId)
  return i >= 0 && prices[i] !== undefined ? money.parse(prices[i]!) : null
}
