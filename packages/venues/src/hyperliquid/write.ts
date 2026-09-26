/**
 * Hyperliquid order placement, cancellation and close (docs/02 §2).
 *
 * Signing goes through the SDK's ExchangeClient with a viem local account.
 * An earlier attempt hand-rolled keccak/secp256k1/RFC 6979 to avoid the viem
 * dependency; it was discarded (2026-09-26) — bespoke signing crypto has no
 * place next to trading keys when an audited implementation is one import
 * away.
 *
 * The key handed in is an AGENT key (docs/04 §1): it can place orders for its
 * master account and cannot withdraw. `revealSignerKey` is called once, to
 * build the viem account, and the string never leaves this module.
 *
 * Hyperliquid has no true market order; a "market" order here is an IOC limit
 * at the best opposing price moved by `maxSlippageBps`, which is also how the
 * venue's own frontend does it. The price is quantized on the conservative
 * side for the order's direction, so rounding can never make it more
 * aggressive than the stated slippage.
 */
import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid"
import { privateKeyToAccount } from "viem/accounts"
import { createHash } from "node:crypto"

import { money } from "@slipstream/shared"
import type { Decimal, IdempotencyKey, VenueOrderId } from "@slipstream/shared"
import { revealSignerKey, type SignerKey } from "@slipstream/shared/secret.js"

import type { Book, OrderRequest, OrderResult, OrderSide } from "../types.js"
import { quantizePrice, quantizeSize, type AssetSpec } from "./quantize.js"

/** The two exchange calls this module makes, so tests can stand in for the venue. */
export interface HyperliquidExchange {
  order(params: {
    orders: {
      a: number
      b: boolean
      p: string
      s: string
      r: boolean
      t: { limit: { tif: "Gtc" | "Ioc" | "Alo" } }
      c?: `0x${string}`
    }[]
    grouping: "na"
  }): Promise<{ response: { data: { statuses: OrderStatus[] } } }>
  cancel(params: { cancels: { a: number; o: number }[] }): Promise<unknown>
}

export type OrderStatus =
  | { resting: { oid: number } }
  | { filled: { totalSz: string; avgPx: string; oid: number } }
  | { error: string }
  | "waitingForFill"
  | "waitingForTrigger"

let sharedTransport: HttpTransport | null = null

/** Build an exchange client for one agent key. */
export function exchangeFor(key: SignerKey): { exchange: HyperliquidExchange; agentAddress: string } {
  const account = privateKeyToAccount(revealSignerKey(key) as `0x${string}`)
  sharedTransport ??= new HttpTransport()
  const client = new ExchangeClient({ transport: sharedTransport, wallet: account })
  return { exchange: client as unknown as HyperliquidExchange, agentAddress: account.address.toLowerCase() }
}

/**
 * Hyperliquid's client order id is 16 bytes of hex. Planner keys are already
 * 32 hex chars; anything else (manual orders) is hashed down to that shape.
 * Same key, same cloid, so the venue itself rejects a resubmission.
 */
export function toCloid(key: IdempotencyKey): `0x${string}` {
  const k = String(key)
  const hex = /^[0-9a-f]{32}$/i.test(k) ? k.toLowerCase() : createHash("sha256").update(k).digest("hex").slice(0, 32)
  return `0x${hex}`
}

const BPS = money.fromInt(10_000)

/** The IOC price for a "market" order: best opposing level moved by the slippage. */
export function marketablePrice(spec: AssetSpec, side: OrderSide, book: Book, maxSlippageBps: number): Decimal | null {
  const top = side === "buy" ? book.asks[0] : book.bids[0]
  if (!top) return null
  const factor = side === "buy"
    ? money.add(money.fromInt(1, 4), money.div(money.fromInt(maxSlippageBps), BPS, 8, "floor"))
    : money.sub(money.fromInt(1, 4), money.div(money.fromInt(maxSlippageBps), BPS, 8, "floor"))
  const raw = money.mul(top.price, factor, 12, side === "buy" ? "floor" : "ceil")
  return quantizePrice(spec, side, raw)
}

export function toOrderResult(status: OrderStatus | undefined, requested: Decimal): OrderResult {
  if (status === undefined) {
    return { venueOrderId: null, status: "rejected", filledSize: money.fromInt(0), avgPrice: null, rejectReason: "no status returned" }
  }
  if (typeof status === "string") {
    return { venueOrderId: null, status: "resting", filledSize: money.fromInt(0), avgPrice: null, rejectReason: null }
  }
  if ("error" in status) {
    return { venueOrderId: null, status: "rejected", filledSize: money.fromInt(0), avgPrice: null, rejectReason: status.error }
  }
  if ("resting" in status) {
    return { venueOrderId: String(status.resting.oid) as VenueOrderId, status: "resting", filledSize: money.fromInt(0), avgPrice: null, rejectReason: null }
  }
  const filled = money.parse(status.filled.totalSz)
  return {
    venueOrderId: String(status.filled.oid) as VenueOrderId,
    status: money.lt(filled, requested) ? "partial" : "filled",
    filledSize: filled,
    avgPrice: money.parse(status.filled.avgPx),
    rejectReason: null,
  }
}

/**
 * Place one order. `book` is required for market orders (to set the IOC price)
 * and ignored for limits. Sizes are re-quantized here even though callers are
 * expected to have done it: rounding down twice is harmless, and a size that
 * slipped through unquantized is a rejected order.
 */
export async function placeOrder(
  exchange: HyperliquidExchange,
  spec: AssetSpec,
  order: OrderRequest,
  book: Book | null,
): Promise<OrderResult> {
  const size = quantizeSize(spec, order.size)
  if (money.isZero(size)) {
    return { venueOrderId: null, status: "rejected", filledSize: money.fromInt(0), avgPrice: null, rejectReason: "size rounds to zero" }
  }
  let price: Decimal | null
  let tif: "Gtc" | "Ioc" | "Alo"
  if (order.kind.type === "market") {
    if (!book) throw new Error("hyperliquid.placeOrder: a market order needs the current book")
    price = marketablePrice(spec, order.side, book, order.kind.maxSlippageBps)
    tif = "Ioc"
  } else {
    price = quantizePrice(spec, order.side, order.kind.price)
    tif = order.kind.tif === "ioc" ? "Ioc" : order.kind.tif === "alo" ? "Alo" : "Gtc"
  }
  if (price === null) {
    return { venueOrderId: null, status: "rejected", filledSize: money.fromInt(0), avgPrice: null, rejectReason: "empty book" }
  }
  const res = await exchange.order({
    orders: [
      {
        a: spec.assetIndex,
        b: order.side === "buy",
        p: money.format(price),
        s: money.format(size),
        r: order.reduceOnly,
        t: { limit: { tif } },
        c: toCloid(order.clientId),
      },
    ],
    grouping: "na",
  })
  return toOrderResult(res.response.data.statuses[0], size)
}

export async function cancelOrder(exchange: HyperliquidExchange, spec: AssetSpec, id: VenueOrderId): Promise<void> {
  await exchange.cancel({ cancels: [{ a: spec.assetIndex, o: Number(id) }] })
}
