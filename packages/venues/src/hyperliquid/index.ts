/** W6 (read + quantize) / W11 (write). Contract: ../types.ts — do not modify it. */
import { notImplemented } from "@slipstream/shared/notimpl.js"
import type { VenueAdapter } from "../types.js"

export const hyperliquidAdapter: VenueAdapter = {
  id: "hyperliquid",

  // --- W6 ---
  listMarkets: () => notImplemented("W6", "hyperliquid.listMarkets"),
  getBook: () => notImplemented("W6", "hyperliquid.getBook"),
  getPositions: () => notImplemented("W6", "hyperliquid.getPositions"),
  getAccountValue: () => notImplemented("W6", "hyperliquid.getAccountValue"),
  getFills: () => notImplemented("W6", "hyperliquid.getFills"),
  watchFills: () => notImplemented("W6", "hyperliquid.watchFills"),
  watchBook: () => notImplemented("W6", "hyperliquid.watchBook"),
  constraints: () => notImplemented("W6", "hyperliquid.constraints"),
  quantize: () => notImplemented("W6", "hyperliquid.quantize"),
  rateBudget: () => notImplemented("W6", "hyperliquid.rateBudget"),
  verifyDelegation: () => notImplemented("W6", "hyperliquid.verifyDelegation"),

  // --- W11 ---
  placeOrder: () => notImplemented("W11", "hyperliquid.placeOrder"),
  cancelOrder: () => notImplemented("W11", "hyperliquid.cancelOrder"),
  closePosition: () => notImplemented("W11", "hyperliquid.closePosition"),
}
