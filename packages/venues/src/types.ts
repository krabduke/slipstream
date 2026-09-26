/**
 * The venue seam.
 *
 * Two venues that look superficially similar and are fundamentally different
 * underneath. Everything above this interface is venue-agnostic: there is no
 * `if (venue === "hyperliquid")` anywhere in copy/, risk/, or exec/.
 *
 * Differences are expressed as *capabilities* (`MarketConstraints`), never as
 * conditionals. A leader running 20x perps gets sized into a 1x prediction
 * market position by arithmetic, not by a branch somebody forgot to write.
 *
 * This file is Wave 0 and is fixed. Implementations (W6/W7/W11/W12) must not
 * modify it; if it looks wrong, stop and say so.
 */
import type { Decimal } from "@slipstream/shared/money/types.js"
import type { SignerKey } from "@slipstream/shared/secret.js"
import type {
  Address,
  IdempotencyKey,
  MarketId,
  Timestamp,
  VenueFillId,
  VenueOrderId,
} from "@slipstream/shared/brand.js"

export type VenueId = "hyperliquid" | "polymarket"

export type OrderSide = "buy" | "sell"
export type PositionSide = "long" | "short"
export type TimeInForce = "gtc" | "ioc" | "alo"

export type MarketKind = "perp" | "spot" | "binary-outcome"

/**
 * `resolved` is Polymarket-only and is NOT a synonym for `closed`. A resolved
 * market settles open positions rather than requiring them to be traded out.
 * The reconciler must distinguish the two or it will mistake settlement for
 * drift and try to "fix" it. See docs/03 §5.
 */
export type MarketStatus = "open" | "halted" | "closed" | "resolved"

export interface MarketConstraints {
  readonly priceTick: Decimal
  readonly sizeLot: Decimal
  readonly minNotional: Decimal
  /** 1 for Polymarket. Read this; never hardcode a venue's leverage. */
  readonly maxLeverage: Decimal
  /** false for Polymarket — selling YES is buying NO, which is a different
   *  MarketId, so shorting genuinely does not exist there. */
  readonly supportsShort: boolean
  readonly supportsReduceOnly: boolean
}

export interface Market {
  readonly id: MarketId
  readonly venue: VenueId
  /** Human-facing label. Never used as an identifier. */
  readonly symbol: string
  readonly kind: MarketKind
  readonly status: MarketStatus
  /** Polymarket resolution time; null on perps and spot. */
  readonly resolvesAt: Timestamp | null
  readonly constraints: MarketConstraints
}

export interface Position {
  readonly venue: VenueId
  readonly marketId: MarketId
  readonly side: PositionSide
  /** Always positive. Direction lives in `side`. */
  readonly size: Decimal
  readonly entryPrice: Decimal
  readonly notional: Decimal
  readonly unrealizedPnl: Decimal
  /** null on venues without leverage. */
  readonly leverage: Decimal | null
  readonly liquidationPrice: Decimal | null
}

export interface Fill {
  readonly id: VenueFillId
  readonly venue: VenueId
  readonly address: Address
  readonly marketId: MarketId
  readonly side: OrderSide
  readonly price: Decimal
  readonly size: Decimal
  readonly fee: Decimal
  readonly ts: Timestamp
  /** Realised PnL attributable to this fill, when the venue reports it. */
  readonly closedPnl: Decimal | null
}

export interface BookLevel {
  readonly price: Decimal
  readonly size: Decimal
}

/** Real depth, not a top-of-book summary — the book-depth gate needs to see
 *  how thin a market is before sizing into it. */
export interface Book {
  readonly marketId: MarketId
  readonly bids: readonly BookLevel[]
  readonly asks: readonly BookLevel[]
  readonly ts: Timestamp
}

export interface BookDelta {
  readonly marketId: MarketId
  readonly bids: readonly BookLevel[]
  readonly asks: readonly BookLevel[]
  readonly ts: Timestamp
  readonly isSnapshot: boolean
}

export type OrderKind =
  | { readonly type: "market"; readonly maxSlippageBps: number }
  | { readonly type: "limit"; readonly price: Decimal; readonly tif: TimeInForce }

export interface OrderRequest {
  readonly marketId: MarketId
  readonly side: OrderSide
  /** Base units of the market. Must already be quantized. */
  readonly size: Decimal
  readonly kind: OrderKind
  readonly reduceOnly: boolean
  readonly clientId: IdempotencyKey
}

export interface OrderResult {
  readonly venueOrderId: VenueOrderId | null
  readonly status: "resting" | "filled" | "partial" | "rejected"
  readonly filledSize: Decimal
  readonly avgPrice: Decimal | null
  readonly rejectReason: string | null
}

export interface QuantizedOrder {
  readonly price: Decimal | null
  readonly size: Decimal
  /** True when quantization reduced the order below the venue minimum, in
   *  which case the caller must skip rather than submit. */
  readonly belowMinimum: boolean
}

/**
 * Proof that `signer` may trade on behalf of `owner` and cannot withdraw.
 *
 * `canWithdraw` is the literal type `false`: it is impossible to construct a
 * proof asserting withdrawal capability, so the security invariant in
 * docs/04 §1 cannot be weakened by a later edit without a type error.
 */
export interface DelegationProof {
  readonly venue: VenueId
  readonly owner: Address
  readonly signer: Address
  readonly canWithdraw: false
  readonly verifiedAt: Timestamp
  /** How it was proven, recorded verbatim in the audit log. */
  readonly method: string
}

export interface VenueAdapter {
  readonly id: VenueId

  // --- read, unauthenticated ---
  listMarkets(): Promise<readonly Market[]>
  getBook(marketId: MarketId, depth: number): Promise<Book>
  getPositions(address: Address): Promise<readonly Position[]>
  getAccountValue(address: Address): Promise<Decimal>
  getFills(address: Address, since: Timestamp): Promise<readonly Fill[]>

  // --- read, streaming ---
  /** First message per address is a snapshot and is a STATE RESET, not a burst
   *  of new fills. Treating it as new fills double-counts history on every
   *  reconnect. See docs/02 §2. */
  watchFills(addresses: readonly Address[]): AsyncIterable<Fill>
  watchBook(marketIds: readonly MarketId[]): AsyncIterable<BookDelta>

  // --- write, authenticated ---
  placeOrder(key: SignerKey, order: OrderRequest): Promise<OrderResult>
  /** Hyperliquid addresses a cancel by asset, so the market is required. */
  cancelOrder(key: SignerKey, marketId: MarketId, id: VenueOrderId): Promise<void>
  /** Reduce-only, aggressive (IOC with wide slippage): a partially filled
   *  close is worse than a slightly worse price (docs/03 §5). `owner` is the
   *  account whose position it is — the key is only its delegated agent.
   *  `size` null closes the whole position. */
  closePosition(
    key: SignerKey,
    owner: Address,
    marketId: MarketId,
    size: Decimal | null,
    clientId: IdempotencyKey,
  ): Promise<OrderResult>

  // --- key lifecycle ---
  /** Runs BEFORE a key is ever written to storage. Fails closed: any error is
   *  a rejection, never a warning. */
  verifyDelegation(owner: Address, signer: Address): Promise<DelegationProof>

  // --- venue rules, so callers never hardcode them ---
  constraints(marketId: MarketId): MarketConstraints
  /** Every order passes through this. Venue tick/lot rules are the single most
   *  common cause of silently rejected orders. */
  quantize(marketId: MarketId, side: OrderSide, price: Decimal | null, size: Decimal): QuantizedOrder

  /** Remaining venue-side action budget, surfaced to the UI as a meter rather
   *  than discovered as a mysterious 3am failure. See docs/02 §2. */
  rateBudget(address: Address): Promise<{ remaining: number; resetsAt: Timestamp | null }>
}
