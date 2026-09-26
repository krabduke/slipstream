/**
 * W6 — the streaming reads.
 *
 * The first test in this file is the one the whole adapter exists to get right.
 * Hyperliquid's `userFills` channel opens with `isSnapshot: true` and a slab of
 * history, and sends it again after every reconnect. Emitting it as new fills
 * replays the leader's entire history on each blip, which desynchronises a copy
 * bot permanently and silently.
 */
import { describe, expect, it } from "vitest"
import { asAddress, asMarketId, money } from "@slipstream/shared"
import { TransportError } from "@nktkas/hyperliquid"
import type { ISubscription } from "@nktkas/hyperliquid"
import type { L2BookEvent, UserFillsEvent } from "@nktkas/hyperliquid/api/subscription"
import type { AssetSpec } from "../quantize.js"
import { buildConstraints } from "../quantize.js"
import { watchBook, watchFills, type HyperliquidSubscriptions } from "../ws.js"
import { USER_FILLS } from "./fixtures.js"

const ADDRESS = asAddress(`0x${"a1".repeat(20)}`)
const USER = `0x${"a1".repeat(20)}` as `0x${string}`

const BTC_SPEC: AssetSpec = {
  marketId: asMarketId("BTC"),
  coin: "BTC",
  symbol: "BTC",
  kind: "perp",
  szDecimals: 5,
  isDelisted: false,
  constraints: buildConstraints("perp", 5, 40),
}

/** Lets a microtask chain — including an `await`ed `Promise.all` — settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const fakeSubscriptions = () => {
  const fillListeners: ((event: UserFillsEvent) => void)[] = []
  const bookListeners: ((event: L2BookEvent) => void)[] = []
  const errorHooks: ((error: TransportError) => void)[] = []
  const coins: string[] = []
  let unsubscribed = 0

  const handle: ISubscription = {
    unsubscribe: async () => {
      unsubscribed += 1
    },
  }

  const subscriptions: HyperliquidSubscriptions = {
    userFills: async (_params, listener, options) => {
      fillListeners.push(listener)
      if (options?.onError) errorHooks.push(options.onError)
      return handle
    },
    l2Book: async (params, listener, options) => {
      coins.push(params.coin)
      bookListeners.push(listener)
      if (options?.onError) errorHooks.push(options.onError)
      return handle
    },
  }

  return {
    subscriptions,
    coins,
    emitFills: (event: UserFillsEvent) => fillListeners.forEach((l) => l(event)),
    emitBook: (event: L2BookEvent) => bookListeners.forEach((l) => l(event)),
    breakSubscription: (error: TransportError) => errorHooks.forEach((h) => h(error)),
    unsubscribed: () => unsubscribed,
  }
}

const fillEvent = (
  tid: number,
  isSnapshot?: true,
  overrides: Partial<UserFillsEvent["fills"][number]> = {},
): UserFillsEvent => {
  const source = USER_FILLS[1]
  if (source === undefined) throw new Error("fixture missing")
  return {
    user: USER,
    fills: [{ ...source, tid, ...overrides }],
    ...(isSnapshot === undefined ? {} : { isSnapshot }),
  }
}

const bookEvent = (time: number): L2BookEvent => ({
  coin: "BTC",
  time,
  levels: [
    [{ px: "77902.0", sz: "4.41798", n: 20 }],
    [{ px: "77903.0", sz: "1.11111", n: 3 }],
  ],
})

describe("watchFills — the snapshot trap", () => {
  it("drops the opening snapshot instead of emitting it as new fills", async () => {
    const fake = fakeSubscriptions()
    const iterator = watchFills(fake.subscriptions, [ADDRESS])[Symbol.asyncIterator]()
    const pending = iterator.next()
    await flush()

    // A snapshot of history, then one genuinely new fill.
    fake.emitFills(fillEvent(111, true))
    fake.emitFills(fillEvent(222))

    const result = await pending
    // If the snapshot leaked through, this would be 111.
    expect(result.done).toBe(false)
    expect(result.value?.id).toBe("222")
    await iterator.return?.()
  })

  it("drops the snapshot that arrives again after a reconnect", async () => {
    const fake = fakeSubscriptions()
    const iterator = watchFills(fake.subscriptions, [ADDRESS])[Symbol.asyncIterator]()
    const first = iterator.next()
    await flush()

    fake.emitFills(fillEvent(1, true))
    fake.emitFills(fillEvent(2))
    expect((await first).value?.id).toBe("2")

    // Reconnect: the transport re-subscribes and the venue restates history.
    const second = iterator.next()
    await flush()
    fake.emitFills(fillEvent(1, true))
    fake.emitFills(fillEvent(3))
    expect((await second).value?.id).toBe("3")
    await iterator.return?.()
  })

  it("keeps both sides when two watched leaders trade with each other", async () => {
    // Dedupe is keyed by address as well as tid. If two watched addresses ever
    // share a tid across the maker/taker sides of one trade, keying on tid alone
    // would silently drop one leader's fill.
    const fake = fakeSubscriptions()
    const other = asAddress(`0x${"b2".repeat(20)}`)
    const iterator = watchFills(fake.subscriptions, [ADDRESS, other])[Symbol.asyncIterator]()
    const first = iterator.next()
    await flush()

    fake.emitFills({ ...fillEvent(4242), user: USER })
    fake.emitFills({ ...fillEvent(4242), user: other as `0x${string}` })

    expect((await first).value?.address).toBe(ADDRESS)
    expect((await iterator.next()).value?.address).toBe(other)
    await iterator.return?.()
  })

  it("emits a repeated tid only once", async () => {
    const fake = fakeSubscriptions()
    const iterator = watchFills(fake.subscriptions, [ADDRESS])[Symbol.asyncIterator]()
    const first = iterator.next()
    await flush()

    fake.emitFills(fillEvent(7))
    fake.emitFills(fillEvent(7))
    fake.emitFills(fillEvent(8))

    expect((await first).value?.id).toBe("7")
    expect((await iterator.next()).value?.id).toBe("8")
    await iterator.return?.()
  })
})

describe("watchFills — mapping and lifecycle", () => {
  it("maps a live fill onto the adapter's shape and attributes it to the venue's user", async () => {
    const fake = fakeSubscriptions()
    const iterator = watchFills(fake.subscriptions, [ADDRESS])[Symbol.asyncIterator]()
    const pending = iterator.next()
    await flush()
    fake.emitFills(fillEvent(99))

    const fill = (await pending).value
    expect(fill?.venue).toBe("hyperliquid")
    expect(fill?.address).toBe(ADDRESS)
    expect(fill?.marketId).toBe("BTC")
    expect(fill?.side).toBe("buy")
    expect(money.format(fill?.price ?? money.fromInt(0))).toBe("77902.0")
    await iterator.return?.()
  })

  it("opens no subscription until the stream is actually consumed", async () => {
    const fake = fakeSubscriptions()
    watchFills(fake.subscriptions, [ADDRESS, asAddress(`0x${"b2".repeat(20)}`)])
    await flush()
    // Building the iterable must not touch the socket.
    fake.emitFills(fillEvent(1))
    expect(fake.unsubscribed()).toBe(0)
  })

  it("unsubscribes when the consumer leaves the loop", async () => {
    const fake = fakeSubscriptions()
    const stream = watchFills(fake.subscriptions, [ADDRESS, asAddress(`0x${"b2".repeat(20)}`)])
    const consumed: string[] = []
    const loop = (async () => {
      for await (const fill of stream) {
        consumed.push(fill.id)
        break
      }
    })()
    await flush()
    fake.emitFills(fillEvent(5))
    await loop
    expect(consumed).toEqual(["5"])
    // One per address: an abandoned stream leaves nothing open.
    expect(fake.unsubscribed()).toBe(2)
  })

  it("surfaces a subscription failure rather than going quiet", async () => {
    const fake = fakeSubscriptions()
    const iterator = watchFills(fake.subscriptions, [ADDRESS])[Symbol.asyncIterator]()
    const pending = iterator.next()
    await flush()
    fake.breakSubscription(new TransportError("socket gone"))
    await expect(pending).rejects.toThrow("socket gone")
    expect(fake.unsubscribed()).toBe(1)
  })

  it("rejects a malformed address before subscribing", () => {
    const fake = fakeSubscriptions()
    expect(() => watchFills(fake.subscriptions, [asAddress("0xnope")])).toThrow(
      /not a 20-byte hex address/,
    )
  })

  it("fails loudly when the consumer falls behind, keeping what it already queued", async () => {
    const fake = fakeSubscriptions()
    const iterator = watchFills(fake.subscriptions, [ADDRESS], {
      maxQueued: 2,
    })[Symbol.asyncIterator]()
    const pending = iterator.next()
    await flush()

    fake.emitFills(fillEvent(1))
    expect((await pending).value?.id).toBe("1")

    // Nobody is waiting now, so these queue up.
    fake.emitFills(fillEvent(2))
    fake.emitFills(fillEvent(3))
    fake.emitFills(fillEvent(4)) // over the limit

    // Already-queued messages are still delivered; only then does it fail.
    expect((await iterator.next()).value?.id).toBe("2")
    expect((await iterator.next()).value?.id).toBe("3")
    await expect(iterator.next()).rejects.toThrow(/messages behind/)
  })
})

describe("watchBook", () => {
  it("marks every message a snapshot, because the venue sends whole books", async () => {
    const fake = fakeSubscriptions()
    const iterator = watchBook(fake.subscriptions, [asMarketId("BTC")], async () => [
      BTC_SPEC,
    ])[Symbol.asyncIterator]()
    const pending = iterator.next()
    await flush()
    fake.emitBook(bookEvent(1788019624369))

    const delta = (await pending).value
    expect(delta?.marketId).toBe("BTC")
    expect(delta?.isSnapshot).toBe(true)
    expect(delta?.ts).toBe(1788019624369)
    expect(money.format(delta?.bids[0]?.price ?? money.fromInt(0))).toBe("77902.0")
    expect(money.format(delta?.asks[0]?.size ?? money.fromInt(0))).toBe("1.11111")
    await iterator.return?.()
  })

  it("subscribes by the venue's wire name and resolves it lazily", async () => {
    const fake = fakeSubscriptions()
    let resolved = 0
    const iterator = watchBook(fake.subscriptions, [asMarketId("@107")], async () => {
      resolved += 1
      return [{ ...BTC_SPEC, marketId: asMarketId("@107"), coin: "@107" }]
    })[Symbol.asyncIterator]()

    // Resolving the catalogue is I/O; it must not happen just to build the iterable.
    expect(resolved).toBe(0)
    const pending = iterator.next()
    await flush()
    expect(resolved).toBe(1)
    expect(fake.coins).toEqual(["@107"])

    fake.emitBook({ ...bookEvent(1), coin: "@107" })
    expect((await pending).value?.marketId).toBe("@107")
    await iterator.return?.()
  })

  it("propagates a catalogue failure to the consumer", async () => {
    const fake = fakeSubscriptions()
    const iterator = watchBook(fake.subscriptions, [asMarketId("NOPE")], async () => {
      throw new Error("unknown market NOPE")
    })[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toThrow("unknown market NOPE")
  })
})
