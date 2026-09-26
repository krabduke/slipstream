import { writeFileSync } from "node:fs"
import { fetchLeaderboard, selectCandidates, profileHyperliquid } from "@slipstream/intel/hyperliquid"
import { WeightBudget, pool } from "@slipstream/intel/http"
const t0 = Date.now()
const cands = selectCandidates(await fetchLeaderboard(), 200)
const pick = cands.filter((_, i) => i % 5 === 0).slice(0, 40)
const budget = new WeightBudget(900)
const { ok, failed } = await pool(pick, 3, (c) => profileHyperliquid(c, budget))
writeFileSync("/tmp/k2_hl_sample.json", JSON.stringify(ok))
console.log(`done ${ok.length} ok, ${failed.length} failed in ${Math.round((Date.now() - t0) / 1000)}s`, failed.slice(0, 3))
