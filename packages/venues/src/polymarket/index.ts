/** W7 (read + quantize) / W12 (write). Contract: ../types.ts — do not modify it. */
import { notImplemented } from "@slipstream/shared/notimpl.js"
import type { VenueAdapter } from "../types.js"

export const polymarketAdapter: VenueAdapter = {
  id: "polymarket",

  // --- W7 ---
  listMarkets: () => notImplemented("W7", "polymarket.listMarkets"),
  getBook: () => notImplemented("W7", "polymarket.getBook"),
  getPositions: () => notImplemented("W7", "polymarket.getPositions"),
  getAccountValue: () => notImplemented("W7", "polymarket.getAccountValue"),
  getFills: () => notImplemented("W7", "polymarket.getFills"),
  watchFills: () => notImplemented("W7", "polymarket.watchFills"),
  watchBook: () => notImplemented("W7", "polymarket.watchBook"),
  constraints: () => notImplemented("W7", "polymarket.constraints"),
  quantize: () => notImplemented("W7", "polymarket.quantize"),
  rateBudget: () => notImplemented("W7", "polymarket.rateBudget"),
  verifyDelegation: () => notImplemented("W7", "polymarket.verifyDelegation"),

  // --- W12 ---
  placeOrder: () => notImplemented("W12", "polymarket.placeOrder"),
  cancelOrder: () => notImplemented("W12", "polymarket.cancelOrder"),
  closePosition: () => notImplemented("W12", "polymarket.closePosition"),
}
