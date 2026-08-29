/** W7 (read + quantize) / W12 (write). Contract: ../types.ts — do not modify it. */
import { notImplemented } from "@slipstream/shared/notimpl.js"
import type { VenueAdapter } from "../types.js"
import { createPolymarketRead } from "./read.js"

/** One process-wide read adapter. It carries a per-market tick cache that the
 *  synchronous `constraints`/`quantize` pair reads, so the instance is shared
 *  deliberately rather than rebuilt per call. */
const read = createPolymarketRead()

export const polymarketAdapter: VenueAdapter = {
  id: "polymarket",

  // --- W7 ---
  listMarkets: read.listMarkets,
  getBook: read.getBook,
  getPositions: read.getPositions,
  getAccountValue: read.getAccountValue,
  getFills: read.getFills,
  watchFills: read.watchFills,
  watchBook: read.watchBook,
  constraints: read.constraints,
  quantize: read.quantize,
  rateBudget: read.rateBudget,

  // Still a stub, and deliberately so. Proving that a signer may trade for an
  // owner and cannot withdraw is a deposit-wallet / L1-auth question rather
  // than a read: it needs `auth.ts`, which W7 does not own. It fails closed
  // meanwhile — this proof gates key storage (docs/04 §1), so a wrong `true`
  // is the most expensive wrong answer available here.
  verifyDelegation: () => notImplemented("W7", "polymarket.verifyDelegation"),

  // --- W12 ---
  placeOrder: () => notImplemented("W12", "polymarket.placeOrder"),
  cancelOrder: () => notImplemented("W12", "polymarket.cancelOrder"),
  closePosition: () => notImplemented("W12", "polymarket.closePosition"),
}

export { createPolymarketRead, POLYMARKET_HOSTS, PolymarketApiError, gammaMarketStatus } from "./read.js"
export type { PolymarketRead, PolymarketReadOptions, ClobReader, VenueSocket } from "./read.js"
export {
  polymarketConstraints,
  quantizePolymarketOrder,
  PRICE_TICK_DEFAULT,
  SIZE_LOT,
  MIN_ORDER_SHARES,
  MIN_ORDER_NOTIONAL,
} from "./quantize.js"
export type { PolymarketMarketRules } from "./quantize.js"
