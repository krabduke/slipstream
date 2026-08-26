/**
 * Branded primitives.
 *
 * These exist so that an `Address` can never be passed where a `MarketId` is
 * expected, and so that a raw `string` from an API response cannot silently
 * become an identifier. Every brand below is a compile-time-only construct;
 * at runtime these are plain strings and numbers.
 */

declare const brand: unique symbol

export type Brand<T, B extends string> = T & { readonly [brand]: B }

/** Lowercase 0x-prefixed EVM address. Normalise on construction, never after. */
export type Address = Brand<string, "Address">

/** Venue-scoped opaque market identifier.
 *  Hyperliquid: the asset symbol (perp) or spot pair.
 *  Polymarket: the CLOB token id — note this encodes the *outcome*, so YES and
 *  NO of the same question are two different MarketIds. This is deliberate: it
 *  lets `supportsShort: false` be literally true rather than a special case. */
export type MarketId = Brand<string, "MarketId">

export type UserId = Brand<string, "UserId">
export type LeaderId = Brand<string, "LeaderId">
export type SubscriptionId = Brand<string, "SubscriptionId">
export type VenueAccountId = Brand<string, "VenueAccountId">
export type IntentId = Brand<string, "IntentId">

/** Identifier returned by the venue for a resting order. */
export type VenueOrderId = Brand<string, "VenueOrderId">

/** Identifier returned by the venue for a fill. Unique per venue; the database
 *  enforces uniqueness on it so replayed snapshots are no-ops. */
export type VenueFillId = Brand<string, "VenueFillId">

/** Caller-generated key that makes order placement safe to retry. */
export type IdempotencyKey = Brand<string, "IdempotencyKey">

/** Epoch milliseconds. */
export type Timestamp = Brand<number, "Timestamp">

export const asAddress = (s: string): Address => s.toLowerCase() as Address
export const asMarketId = (s: string): MarketId => s as MarketId
export const asTimestamp = (n: number): Timestamp => n as Timestamp
