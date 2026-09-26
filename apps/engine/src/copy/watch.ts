/**
 * Hyperliquid leader-fill watcher.
 *
 * Subscribes to `userFills` for every followed leader, records each fill as
 * that leader's latest reference for the market (what the signal-age and
 * slippage gates judge), and asks for an immediate copy cycle. The reconciler
 * timer still runs regardless, so a dropped socket costs latency, never
 * correctness (docs/03 §2).
 *
 * The subscription set is re-derived every 30 seconds; when the set of
 * followed leaders changes, the stream is closed and reopened.
 */
import type { Address, LeaderRef, MarketId } from "@slipstream/shared"
import type { Logger } from "@slipstream/shared/log/index.js"
import { hl, hlLastFill } from "./venues.js"

export function startHlWatcher(opts: {
  leaders: () => Promise<string[]>
  onFill: (leader: string) => void
  log: Logger
}): () => void {
  let stopped = false
  let current = ""
  let iterator: AsyncIterator<unknown> | null = null

  const run = async (addrs: string[]) => {
    const stream = hl.watchFills(addrs as Address[])[Symbol.asyncIterator]()
    iterator = stream
    try {
      for (;;) {
        const { value, done } = await stream.next()
        if (done || stopped) break
        const fill = value as { address: string; marketId: MarketId; price: LeaderRef["leaderFillPrice"]; ts: LeaderRef["leaderFillTs"] }
        const key = fill.address.toLowerCase()
        const byMarket = hlLastFill.get(key) ?? new Map<MarketId, LeaderRef>()
        const prev = byMarket.get(fill.marketId)
        if (!prev || prev.leaderFillTs <= fill.ts) {
          byMarket.set(fill.marketId, { leaderAddress: key as Address, leaderFillPrice: fill.price, leaderFillTs: fill.ts })
        }
        hlLastFill.set(key, byMarket)
        opts.onFill(key)
      }
    } catch (e) {
      opts.log.warn(`hl watcher: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200))
    }
  }

  const refresh = async () => {
    if (stopped) return
    try {
      const addrs = [...new Set((await opts.leaders()).map((a) => a.toLowerCase()))].sort()
      const key = addrs.join(",")
      if (key !== current || iterator === null) {
        await iterator?.return?.()
        iterator = null
        current = key
        if (addrs.length) {
          opts.log.info(`hl watcher: watching ${addrs.length} leader(s)`)
          void run(addrs).finally(() => {
            // Stream ended (socket closed or error): force a resubscribe next refresh.
            if (current === key) iterator = null
          })
        }
      }
    } catch (e) {
      opts.log.warn(`hl watcher refresh: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200))
    }
  }

  void refresh()
  const timer = setInterval(() => void refresh(), 30_000)
  return () => {
    stopped = true
    clearInterval(timer)
    void iterator?.return?.()
  }
}
