/**
 * W6 — Hyperliquid streaming reads over `wss://api.hyperliquid.xyz/ws`.
 *
 * The per-IP request budget is 1200 weight/minute and is shared by every user on
 * an engine instance, so steady-state market data comes from here, not from
 * polling `/info`.
 *
 * ## The `userFills` snapshot trap
 *
 * The first `userFills` message on a subscription carries `isSnapshot: true` and
 * a slab of the address's fill history. Verified live: subscribing to
 * `0x8c625f…c974` returned one message with `isSnapshot: true` and 30 fills, the
 * newest of which was already a month old.
 *
 * That message is the venue **restating state**, not reporting trades. It
 * arrives again after every reconnect, because the transport re-subscribes. A
 * consumer that treats it as new fills re-emits the entire history on every
 * network blip, which is how a naive copy bot ends up permanently and silently
 * out of sync with its leader.
 *
 * So {@link watchFills} drops snapshot messages outright. History belongs to
 * `getFills`, which is bounded, ordered, and idempotent by `tid`.
 *
 * ## Backpressure
 *
 * A consumer that stops draining the iterator makes the queue grow without
 * bound. Rather than dropping fills — which is the same desynchronisation with
 * a quieter failure mode — the stream throws once it is more than `maxQueued`
 * messages behind.
 */
import { asAddress, asTimestamp } from "@slipstream/shared"
import type { Address, MarketId } from "@slipstream/shared"
import type { ISubscription, SubscriptionClient } from "@nktkas/hyperliquid"
import type { BookDelta, Fill } from "../types.js"
import type { AssetSpec } from "./quantize.js"
import { toBookLevels, toFill, toHexAddress } from "./read.js"

/** The slice of `SubscriptionClient` this adapter uses. */
export type HyperliquidSubscriptions = Pick<SubscriptionClient, "userFills" | "l2Book">

export interface WatchOptions {
  /** Messages the consumer may fall behind by before the stream fails loudly. */
  readonly maxQueued?: number
  /** How many recent fills to remember when suppressing duplicates. */
  readonly dedupeWindow?: number
}

export const DEFAULT_MAX_QUEUED = 10_000
export const DEFAULT_DEDUPE_WINDOW = 10_000

/**
 * Remembers the last `limit` keys in insertion order and reports whether a key
 * is new. Bounded on purpose: an unbounded dedupe set on a long-lived stream is
 * a memory leak that only shows up in production.
 */
const createIdFilter = (limit: number): ((key: string) => boolean) => {
  const seen = new Set<string>()
  return (key: string): boolean => {
    if (seen.has(key)) return false
    seen.add(key)
    if (seen.size > limit) {
      const oldest = seen.values().next()
      if (!oldest.done) seen.delete(oldest.value)
    }
    return true
  }
}

/**
 * Turns a callback subscription into a single-consumer `AsyncIterable`.
 *
 * Subscribing is deferred to the first `next()`, so building the iterable costs
 * nothing and opens no socket. Leaving the `for await` loop — by `break`,
 * `return`, or a throw — runs `return()`, which unsubscribes; the subscriptions
 * are owned by the iterator, not by the adapter, so an abandoned stream does not
 * leak a live subscription.
 */
const createStream = <T>(
  label: string,
  maxQueued: number,
  subscribe: (
    push: (item: T) => void,
    fail: (error: unknown) => void,
  ) => Promise<readonly ISubscription[]>,
): AsyncIterable<T> => ({
  [Symbol.asyncIterator](): AsyncIterator<T> {
    const queue: T[] = []
    let subscriptions: readonly ISubscription[] = []
    let started = false
    let finished = false
    let failure: { readonly error: unknown } | null = null
    let wake: (() => void) | null = null

    const signal = (): void => {
      const waiter = wake
      wake = null
      waiter?.()
    }

    const fail = (error: unknown): void => {
      if (finished) return
      failure ??= { error }
      signal()
    }

    const push = (item: T): void => {
      if (finished) return
      if (queue.length >= maxQueued) {
        fail(
          new Error(
            `hyperliquid.${label}: consumer is more than ${String(maxQueued)} messages behind; ` +
              `failing rather than dropping messages`,
          ),
        )
        return
      }
      queue.push(item)
      signal()
    }

    const stop = async (): Promise<void> => {
      finished = true
      const open = subscriptions
      subscriptions = []
      queue.length = 0
      // Settle every unsubscribe: one failing must not strand the others.
      await Promise.allSettled(open.map((subscription) => subscription.unsubscribe()))
    }

    return {
      async next(): Promise<IteratorResult<T>> {
        if (!started) {
          started = true
          try {
            subscriptions = await subscribe(push, fail)
          } catch (error) {
            finished = true
            throw error
          }
          // The consumer may have abandoned the stream while we were subscribing.
          if (finished) {
            await Promise.allSettled(subscriptions.map((s) => s.unsubscribe()))
            subscriptions = []
            return { done: true, value: undefined }
          }
        }
        for (;;) {
          if (queue.length > 0) {
            const value = queue.shift()
            if (value !== undefined) return { done: false, value }
          }
          if (failure !== null) {
            const { error } = failure
            failure = null
            await stop()
            throw error
          }
          if (finished) return { done: true, value: undefined }
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
      },
      async return(): Promise<IteratorResult<T>> {
        await stop()
        signal()
        return { done: true, value: undefined }
      },
      async throw(error: unknown): Promise<IteratorResult<T>> {
        await stop()
        signal()
        throw error
      },
    }
  },
})

/**
 * Live fills for the given addresses.
 *
 * Snapshot messages are dropped — see the note at the top of this file. Fills
 * are additionally deduplicated by `tid` within a bounded window, so a
 * re-subscription that replays the tail of the feed cannot emit the same fill
 * twice.
 */
export const watchFills = (
  subscriptions: HyperliquidSubscriptions,
  addresses: readonly Address[],
  options: WatchOptions = {},
): AsyncIterable<Fill> => {
  const users = addresses.map((address) => toHexAddress(address, "watchFills"))
  const isNew = createIdFilter(options.dedupeWindow ?? DEFAULT_DEDUPE_WINDOW)

  return createStream<Fill>(
    "watchFills",
    options.maxQueued ?? DEFAULT_MAX_QUEUED,
    async (push, fail) =>
      Promise.all(
        users.map((user) =>
          subscriptions.userFills(
            { user },
            (event) => {
              // STATE RESET, not new fills. Yielding these double-counts the
              // address's whole history on every reconnect.
              if (event.isSnapshot === true) return
              const owner = asAddress(event.user)
              for (const raw of event.fills) {
                // Keyed by address as well as `tid`: two watched leaders can be
                // counterparties to each other, and a shared `tid` between the
                // maker and taker side would otherwise drop one of their fills.
                if (!isNew(`${owner}:${String(raw.tid)}`)) continue
                push(toFill(raw, owner))
              }
            },
            { onError: fail },
          ),
        ),
      ),
  )
}

/**
 * Live order books for the given markets.
 *
 * `isSnapshot` is always `true`: Hyperliquid's `l2Book` channel publishes whole
 * books rather than diffs — verified live, its messages carry no delta marker
 * and repeat all 20 levels a side — so each message replaces the previous state
 * rather than amending it.
 *
 * `resolveSpecs` is awaited inside the subscribe step so that warming the market
 * catalogue stays off the synchronous path.
 */
export const watchBook = (
  subscriptions: HyperliquidSubscriptions,
  marketIds: readonly MarketId[],
  resolveSpecs: (ids: readonly MarketId[]) => Promise<readonly AssetSpec[]>,
  options: WatchOptions = {},
): AsyncIterable<BookDelta> =>
  createStream<BookDelta>(
    "watchBook",
    options.maxQueued ?? DEFAULT_MAX_QUEUED,
    async (push, fail) => {
      const specs = await resolveSpecs(marketIds)
      return Promise.all(
        specs.map((spec) =>
          subscriptions.l2Book(
            { coin: spec.coin, nSigFigs: null },
            (event) => {
              const [bids, asks] = event.levels
              push({
                marketId: spec.marketId,
                bids: toBookLevels(bids, bids.length),
                asks: toBookLevels(asks, asks.length),
                ts: asTimestamp(event.time),
                isSnapshot: true,
              })
            },
            { onError: fail },
          ),
        ),
      )
    },
  )
