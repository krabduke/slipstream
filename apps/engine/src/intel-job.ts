/**
 * Trader-intelligence refresh: profile the best wallets on each venue and
 * store them for the Traders pages. Every run is recorded in `intel_runs` so a
 * stalled refresh is visible, not silent.
 */
import type { Db } from "@slipstream/db"
import { finishIntelRun, latestIntelRuns, startIntelRun, upsertTraderProfiles } from "@slipstream/db/queries/index.js"
import { refreshHyperliquid } from "@slipstream/intel/hyperliquid"
import { refreshPolymarket } from "@slipstream/intel/polymarket"
import type { Logger } from "@slipstream/shared/log/index.js"

export type IntelVenue = "hyperliquid" | "polymarket"

export async function runIntel(db: Db, venue: IntelVenue, log: Logger, opts: { limit?: number } = {}) {
  const runId = await startIntelRun(db, venue)
  const say = (m: string) => log.info(m)
  try {
    let written = 0
    const onBatch = async (batch: Parameters<typeof upsertTraderProfiles>[1]) => {
      written += await upsertTraderProfiles(db, batch)
    }
    const r =
      venue === "hyperliquid"
        ? await refreshHyperliquid({ limit: opts.limit ?? 200, log: say, onBatch })
        : await refreshPolymarket({ limit: opts.limit ?? 200, log: say, onBatch })
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

/** Milliseconds until a venue's next refresh is due, from its last finished run. */
export async function msUntilDue(db: Db, venue: IntelVenue, everyMs: number): Promise<number> {
  const runs = await latestIntelRuns(db)
  const last = runs.find((r) => r.venue === venue && (r.profiled ?? 0) >= 20)
  if (!last) return 0
  return Math.max(0, new Date(last.finished_at).getTime() + everyMs - Date.now())
}
