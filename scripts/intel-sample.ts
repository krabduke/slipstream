import { fetchLeaderboard, selectCandidates, profileHyperliquid } from "@slipstream/intel/hyperliquid"
import { WeightBudget } from "@slipstream/intel/http"
const t0 = Date.now()
const rows = await fetchLeaderboard()
const cands = selectCandidates(rows, 200)
console.log(`leaderboard ${rows.length} -> ${cands.length} candidates in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
const budget = new WeightBudget(700)
for (const c of cands.slice(0, 4)) {
  const t = Date.now()
  const p = await profileHyperliquid(c, budget)
  console.log(`${p.address.slice(0, 10)} score=${p.score} copyable=${p.copyable} flags=${p.flags.join(",") || "-"} ` +
    `acct=$${Math.round(p.accountValue ?? 0).toLocaleString()} roiAll=${(p.roi.all ?? 0).toFixed(2)} dd=${p.maxDrawdownPct?.toFixed(3)} ` +
    `weeks=${p.profitableWeeks}/${p.activeWeeks} trips=${p.tradeCount} win=${p.winRate?.toFixed(2)} hold=${Math.round((p.medianHoldSecs ?? 0) / 60)}m ` +
    `open=${p.openPositions.length} parts=${JSON.stringify(Object.fromEntries(Object.entries(p.scoreParts).map(([k, v]) => [k, +v.toFixed(2)])))} (${Date.now() - t}ms)`)
}
