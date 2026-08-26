/**
 * Barrel. Written in Wave 0 with every export already present, pointing at
 * files that do not exist yet, so no two workers ever edit the same file.
 * See docs/08 §8.
 */
export type * from "./types.js"

// W6 / W11 — Hyperliquid
export { hyperliquidAdapter } from "./hyperliquid/index.js"

// W7 / W12 — Polymarket
export { polymarketAdapter } from "./polymarket/index.js"
