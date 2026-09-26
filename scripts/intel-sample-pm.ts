import { pmCandidates, profilePolymarket } from "@slipstream/intel/polymarket"
const t0 = Date.now()
const c = await pmCandidates(200)
console.log(`${c.length} candidates in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
for (const x of [c[0]!, c[1]!, c[40]!, c[80]!, c[150]!, c[199]!].filter(Boolean)) {
  const t = Date.now()
  const p = await profilePolymarket(x)
  console.log(`${p.displayName ?? p.address.slice(0, 10)} score=${p.score} copyable=${p.copyable} flags=${p.flags.join(",") || "-"} value=$${Math.round(p.accountValue ?? 0).toLocaleString()} pnlAll=$${Math.round(p.pnl.all ?? 0).toLocaleString()} edge=${p.roi.all?.toFixed(3)} dd=${p.maxDrawdownPct?.toFixed(2)} wk=${p.profitableWeeks}/${p.activeWeeks} closed=${p.tradeCount} win=${p.winRate?.toFixed(2)} top=${p.topMarkets[0]?.name.slice(0, 40)} (${Date.now() - t}ms)`)
}
