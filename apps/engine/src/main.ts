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
import { msUntilDue, runIntel, type IntelVenue } from "./intel-job.js"
import { CopyEngine } from "./copy/cycle.js"
import { heartbeat, loadActiveFollows } from "./copy/store.js"
import { startHlWatcher } from "./copy/watch.js"

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
const STARTED_AT = new Date().toISOString()
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
  if (job === "copy:hl" || job === "copy:pm") {
    // One reconcile pass without the fill watcher, for testing a deploy.
    const copy = new CopyEngine(db, log)
    copy
      .runCycle(job === "copy:hl" ? "hyperliquid" : "polymarket")
      .then(() => {
        log.info(`copy ${job}: ${JSON.stringify(copy.lastCycle)}`)
        process.exit(0)
      })
      .catch((e) => {
        log.error(`copy ${job}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`.slice(0, 800))
        process.exit(1)
      })
  }
  const venue: IntelVenue | null = job === "intel:hl" ? "hyperliquid" : job === "intel:pm" ? "polymarket" : null
  if (!venue && job !== "copy:hl" && job !== "copy:pm") {
    log.error(`unknown --once job ${job}; expected intel:hl, intel:pm, copy:hl or copy:pm`)
    process.exit(2)
  }
  const limit = process.env["INTEL_LIMIT"] ? Number(process.env["INTEL_LIMIT"]) : undefined
  if (venue) runIntel(db, venue, log, { limit })
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
} else {
  log.info("engine starting")
  // Each venue is refreshed on its own schedule, counted from its last
  // finished run rather than from process start, so a restart does not throw
  // away a refresh. Hyperliquid starts at least 2 minutes after Polymarket so
  // their bursts do not overlap.
  void (async () => {
    const [pmDue, hlDue] = await Promise.all([
      msUntilDue(db, "polymarket", INTEL_EVERY).catch(() => 0),
      msUntilDue(db, "hyperliquid", INTEL_EVERY).catch(() => 0),
    ])
    log.info(`intel schedule: polymarket in ${Math.round(pmDue / 60_000)} min, hyperliquid in ${Math.round(Math.max(hlDue, 120_000) / 60_000)} min`)
    every("intel:polymarket", INTEL_EVERY, Math.max(pmDue, 5_000), () => runIntel(db, "polymarket", log))
    every("intel:hyperliquid", INTEL_EVERY, Math.max(hlDue, 120_000), () => runIntel(db, "hyperliquid", log))
  })()

  // Copy trading. The timers are the reconciler: they run whether or not any
  // event arrived, which is what makes a missed WebSocket message harmless.
  const copy = new CopyEngine(db, log)
  let hlQueued: ReturnType<typeof setTimeout> | null = null
  const hlSoon = () => {
    if (hlQueued) return
    hlQueued = setTimeout(() => {
      hlQueued = null
      void copyHl()
    }, 750)
  }
  let hlRunning = false
  const copyHl = async () => {
    if (hlRunning) return
    hlRunning = true
    try {
      await copy.runCycle("hyperliquid")
    } catch (e) {
      log.error(`copy:hyperliquid: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300))
    } finally {
      hlRunning = false
    }
  }
  setInterval(() => void copyHl(), Number(process.env["COPY_HL_EVERY_MS"] ?? 10_000))
  every("copy:polymarket", Number(process.env["COPY_PM_EVERY_MS"] ?? 30_000), 15_000, () => copy.runCycle("polymarket"))
  startHlWatcher({
    leaders: async () => (await loadActiveFollows(db)).filter((f) => f.venue === "hyperliquid").map((f) => f.leaderAddress),
    onFill: hlSoon,
    log,
  })

  // Heartbeat: what the site's status band reads to say whether the engine is alive.
  const beat = () =>
    heartbeat(db, "vps-1", { copy: copy.lastCycle, pid: process.pid, startedAt: STARTED_AT }).catch((e) =>
      log.warn(`heartbeat: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)),
    )
  void beat()
  setInterval(() => void beat(), 15_000)
  const stop = (sig: string) => {
    log.info(`engine stopping (${sig})`)
    process.exit(0)
  }
  process.on("SIGTERM", () => stop("SIGTERM"))
  process.on("SIGINT", () => stop("SIGINT"))
}
