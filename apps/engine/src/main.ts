/**
 * slipstream-engine: the always-on process (docs/01 §1).
 *
 * Today it runs the trader-intelligence schedule. The copy engine (leader
 * watcher, planner, risk gate, executors, reconciler) is added alongside it
 * in the same process; each part is a loop with its own interval and its own
 * failure isolation, so one crashing never stops the others.
 *
 *   node dist/engine.mjs                      run forever
 *   node dist/engine.mjs --once intel:hl      one Hyperliquid refresh, then exit
 *   node dist/engine.mjs --once intel:pm      one Polymarket refresh, then exit
 */
import { createNodeDb as createDb } from "@slipstream/db/node.js"
import { createLogger } from "@slipstream/shared/log/index.js"
import { runIntel, type IntelVenue } from "./intel-job.js"

const log = createLogger({ bindings: { service: "engine" } })

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    log.error(`missing required environment variable ${name}`)
    process.exit(2)
  }
  return v
}

const db = createDb(requireEnv("DATABASE_URL"))

const HOUR = 3_600_000
const INTEL_EVERY = Number(process.env["INTEL_EVERY_HOURS"] ?? 6) * HOUR

/** Run `fn` now (after `delayMs`) and then every `everyMs`, never overlapping. */
function every(name: string, everyMs: number, delayMs: number, fn: () => Promise<unknown>) {
  let running = false
  const tick = async () => {
    if (running) {
      log.warn(`${name}: previous run still going, skipping this tick`)
      return
    }
    running = true
    try {
      await fn()
    } catch (e) {
      log.error(`${name}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400))
    } finally {
      running = false
    }
  }
  setTimeout(() => {
    void tick()
    setInterval(() => void tick(), everyMs)
  }, delayMs)
}

const once = process.argv.indexOf("--once")
if (once !== -1) {
  const job = process.argv[once + 1]
  const venue: IntelVenue | null = job === "intel:hl" ? "hyperliquid" : job === "intel:pm" ? "polymarket" : null
  if (!venue) {
    log.error(`unknown --once job ${job}; expected intel:hl or intel:pm`)
    process.exit(2)
  }
  const limit = process.env["INTEL_LIMIT"] ? Number(process.env["INTEL_LIMIT"]) : undefined
  runIntel(db, venue, log, { limit })
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
} else {
  log.info("engine starting")
  // Stagger the venues so their API bursts never overlap.
  every("intel:polymarket", INTEL_EVERY, 5_000, () => runIntel(db, "polymarket", log))
  every("intel:hyperliquid", INTEL_EVERY, 20 * 60_000, () => runIntel(db, "hyperliquid", log))
  const stop = (sig: string) => {
    log.info(`engine stopping (${sig})`)
    process.exit(0)
  }
  process.on("SIGTERM", () => stop("SIGTERM"))
  process.on("SIGINT", () => stop("SIGINT"))
}
