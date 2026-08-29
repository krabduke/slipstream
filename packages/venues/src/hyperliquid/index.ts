/**
 * W6 (read + quantize) / W11 (write). Contract: ../types.ts — do not modify it.
 *
 * Assembly only: the real code lives in `read.ts`, `quantize.ts` and `ws.ts`.
 *
 * ## Why there is a factory as well as a singleton
 *
 * `constraints()` and `quantize()` are synchronous by contract, and both need
 * per-asset `szDecimals` and leverage caps from `meta`/`spotMeta`. That metadata
 * has to be cached rather than fetched on demand.
 *
 * It is *not* fetched when this module is imported. `packages/venues/src/index.ts`
 * is a barrel that half the repository pulls in, and an import that opens a
 * socket turns every unrelated unit test into a network call. Instead the
 * catalogue is loaded by {@link HyperliquidAdapter.warmUp} or by the first async
 * read, and until then the two synchronous methods throw a message that says so.
 * Callers that want them ready with no I/O at all construct the adapter with a
 * prebuilt `catalog`.
 *
 * Transports are created lazily for the same reason: `WebSocketTransport` starts
 * connecting in its constructor, so it is built on the first `watch*` call and
 * released by {@link HyperliquidAdapter.close}.
 */
import {
  HttpTransport,
  InfoClient,
  SubscriptionClient,
  WebSocketTransport,
} from "@nktkas/hyperliquid"
import { notImplemented } from "@slipstream/shared/notimpl.js"
import type { MarketId } from "@slipstream/shared"
import type { VenueAdapter } from "../types.js"
import type { AssetSpec } from "./quantize.js"
import { quantizeOrder } from "./quantize.js"
import type { HyperliquidCatalog, HyperliquidInfo } from "./read.js"
import * as read from "./read.js"
import type { HyperliquidSubscriptions } from "./ws.js"
import * as ws from "./ws.js"

/**
 * How long a loaded catalogue is reused before the next async read refreshes it.
 * New listings appear on the order of days, so this is about noticing them, not
 * about the correctness of an existing market's tick and lot.
 */
export const DEFAULT_CATALOG_TTL_MS = 15 * 60 * 1000

export interface HyperliquidAdapterOptions {
  /** Substitute for the `/info` client. Supplied by tests; defaults to HTTP. */
  readonly info?: HyperliquidInfo
  /** Substitute for the WS subscription client. Supplied by tests. */
  readonly subscriptions?: HyperliquidSubscriptions
  /** Prebuilt market catalogue, so `constraints()` works with no I/O ever. */
  readonly catalog?: HyperliquidCatalog
  readonly catalogTtlMs?: number
  readonly maxQueuedMessages?: number
}

export interface HyperliquidAdapter extends VenueAdapter {
  /**
   * Loads and caches `meta` + `spotMeta`. `constraints()` and `quantize()` are
   * synchronous and do no I/O, so this (or any async read) must run first.
   * Concurrent calls share one request.
   */
  warmUp(): Promise<HyperliquidCatalog>
  /** Releases the WebSocket transport this adapter opened, if it opened one. */
  close(): Promise<void>
}

export const createHyperliquidAdapter = (
  options: HyperliquidAdapterOptions = {},
): HyperliquidAdapter => {
  const catalogTtlMs = options.catalogTtlMs ?? DEFAULT_CATALOG_TTL_MS
  const watchOptions = { maxQueued: options.maxQueuedMessages }

  let httpTransport: HttpTransport | null = null
  let infoClient: HyperliquidInfo | null = options.info ?? null
  let wsTransport: WebSocketTransport | null = null
  let subscriptionClient: HyperliquidSubscriptions | null = options.subscriptions ?? null

  let catalog: HyperliquidCatalog | null = options.catalog ?? null
  let inFlight: Promise<HyperliquidCatalog> | null = null

  const info = (): HyperliquidInfo => {
    if (infoClient === null) {
      httpTransport ??= new HttpTransport()
      infoClient = new InfoClient({ transport: httpTransport })
    }
    return infoClient
  }

  const subscriptions = (): HyperliquidSubscriptions => {
    if (subscriptionClient === null) {
      // Connects immediately, which is why this is not done at construction.
      wsTransport ??= new WebSocketTransport()
      subscriptionClient = new SubscriptionClient({ transport: wsTransport })
    }
    return subscriptionClient
  }

  const warmUp = async (): Promise<HyperliquidCatalog> => {
    if (catalog !== null && Date.now() - catalog.fetchedAt < catalogTtlMs) return catalog
    // Single-flight: `meta` and `spotMeta` weigh 20 each, and a burst of callers
    // starting at once must not spend that budget once per caller.
    inFlight ??= read.fetchCatalog(info()).then(
      (loaded) => {
        catalog = loaded
        inFlight = null
        return loaded
      },
      (error: unknown) => {
        inFlight = null
        throw error
      },
    )
    return inFlight
  }

  /** Synchronous lookup for the two synchronous methods. Never does I/O. */
  const cachedSpec = (marketId: MarketId, what: string): AssetSpec => {
    if (catalog === null) {
      throw new Error(
        `hyperliquid.${what}: market metadata is not loaded. ${what}() is synchronous by ` +
          `contract, so call warmUp() (or any async read) first, or construct the adapter ` +
          `with { catalog }.`,
      )
    }
    // Deliberately ignores the TTL: a slightly stale szDecimals is far better
    // than a throw, and refreshing here would mean doing I/O.
    return read.lookupSpec(catalog, marketId, what)
  }

  return {
    id: "hyperliquid",

    // --- W6: read, unauthenticated ---
    listMarkets: async () => (await warmUp()).markets,

    getBook: async (marketId, depth) =>
      read.getBook(info(), read.lookupSpec(await warmUp(), marketId, "getBook"), depth),

    getPositions: (address) => read.getPositions(info(), address),

    getAccountValue: (address) => read.getAccountValue(info(), address),

    getFills: (address, since) => read.getFills(info(), address, since),

    // --- W6: read, streaming ---
    watchFills: (addresses) => ws.watchFills(subscriptions(), addresses, watchOptions),

    watchBook: (marketIds) =>
      ws.watchBook(
        subscriptions(),
        marketIds,
        async (ids) => {
          const loaded = await warmUp()
          return ids.map((id) => read.lookupSpec(loaded, id, "watchBook"))
        },
        watchOptions,
      ),

    // --- W6: key lifecycle ---
    verifyDelegation: (owner, signer) => read.verifyDelegation(info(), owner, signer),

    // --- W6: venue rules (synchronous — see the note at the top of this file) ---
    constraints: (marketId) => cachedSpec(marketId, "constraints").constraints,

    quantize: (marketId, side, price, size) =>
      quantizeOrder(cachedSpec(marketId, "quantize"), side, price, size),

    rateBudget: (address) => read.rateBudget(info(), address),

    // --- W11 ---
    placeOrder: () => notImplemented("W11", "hyperliquid.placeOrder"),
    cancelOrder: () => notImplemented("W11", "hyperliquid.cancelOrder"),
    closePosition: () => notImplemented("W11", "hyperliquid.closePosition"),

    // --- lifecycle beyond the VenueAdapter contract ---
    warmUp,

    close: async () => {
      const transport = wsTransport
      wsTransport = null
      // Drop only a client this adapter built; an injected one belongs to the caller.
      subscriptionClient = options.subscriptions ?? null
      transport?.close()
      await Promise.resolve()
    },
  }
}

/** The process-wide adapter. Call `warmUp()` once at startup. */
export const hyperliquidAdapter: HyperliquidAdapter = createHyperliquidAdapter()

export type { AssetSpec, HyperliquidMarketKind } from "./quantize.js"
export type { HyperliquidCatalog, HyperliquidInfo } from "./read.js"
export type { HyperliquidSubscriptions, WatchOptions } from "./ws.js"
