/**
 * Trader-intelligence refresh: profile the best wallets on each venue and
 * store them for the Traders pages. Every run is recorded in `intel_runs` so a
 * stalled refresh is visible, not silent.
 */
import type { Db } from "@slipstream/db"
import { finishIntelRun, startIntelRun, upsertTraderProfiles } from "@slipstream/db/queries/index.js"
import { refreshHyperliquid } from "@slipstream/intel/hyperliquid"
import { refreshPolymarket } from "@slipstream/intel/polymarket"
import type { Logger } from "@slipstream/shared/log/index.js"

export type IntelVenue = "hyperliquid" | "polymarket"

export async function runIntel(db: Db, venue: IntelVenue, log: Logger, opts: { limit?: number } = {}) {
  const runId = await startIntelRun(db, venue)
  const say = (m: string) => log.info(m)
  try {
    const r =
      venue === "hyperliquid"
        ? await refreshHyperliquid({ limit: opts.limit ?? 200, log: say })
        : await refreshPolymarket({ limit: opts.limit ?? 200, log: say })
    const written = await upsertTraderProfiles(db, r.profiles)
    await finishIntelRun(db, runId, { candidates: r.candidates, profiled: written, failed: r.failed })
    log.info(`intel ${venue}: ${written} profiles written, ${r.failed} failed, ${r.candidates} candidates`)
    return { written, failed: r.failed }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await finishIntelRun(db, runId, { error: msg.slice(0, 500) }).catch(() => {})
    log.error(`intel ${venue} failed: ${msg.slice(0, 300)}`)
    throw e
  }
}
