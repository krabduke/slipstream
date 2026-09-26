import type { CopyFlag } from "@slipstream/intel/types"

/** What each flag means, in the reader's terms. Blocking flags explain why a
 *  copy would fail; the others are caveats about the evidence. */
export const FLAG_TEXT: Record<CopyFlag, { label: string; why: string; blocking: boolean }> = {
  scalper: {
    label: "Scalper",
    why: "Half their trades close within five minutes. A copy arrives after the move it was meant to catch.",
    blocking: true,
  },
  high_frequency: {
    label: "High frequency",
    why: "Dozens of round trips a day. At that pace copying is mostly paying fees and slippage.",
    blocking: true,
  },
  market_maker: {
    label: "Market maker",
    why: "Trades well over a hundred times their equity each month. That is inventory management, not a view you can follow.",
    blocking: true,
  },
  short_horizon_markets: {
    label: "Short-horizon markets",
    why: "Most of their positions are 5- or 15-minute markets that resolve before a copy could matter.",
    blocking: true,
  },
  vault: { label: "Vault", why: "This is a Hyperliquid vault, not an individual trader.", blocking: true },
  inactive: {
    label: "Inactive",
    why: "No trades in 30 days, or the account has been emptied. There is nothing to copy right now.",
    blocking: true,
  },
  low_sample: {
    label: "Few trades",
    why: "Too few closed trades to tell skill from luck. The score is scaled down for it.",
    blocking: false,
  },
  one_big_win: {
    label: "One big win",
    why: "Most of the profit came from a single trade or market. The score is scaled down for it.",
    blocking: false,
  },
}
