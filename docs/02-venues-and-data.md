# 02 — Venues and Data

## 1. The `VenueAdapter` seam

Two venues that look superficially similar (a book, an order, a position) and are fundamentally different underneath. The adapter interface is where that difference is absorbed, so nothing above it has an `if (venue === 'hyperliquid')` branch.

```ts
interface VenueAdapter {
  readonly id: VenueId                     // 'hyperliquid' | 'polymarket'

  // --- read, unauthenticated ---
  listMarkets(): Promise<Market[]>
  getBook(marketId: MarketId, depth: number): Promise<Book>
  getPositions(address: Address): Promise<Position[]>
  getAccountValue(address: Address): Promise<Decimal>
  getFills(address: Address, since: Timestamp): Promise<Fill[]>

  // --- read, streaming ---
  watchFills(addresses: Address[]): AsyncIterable<Fill>
  watchBook(marketIds: MarketId[]): AsyncIterable<BookDelta>

  // --- write, authenticated ---
  placeOrder(key: DecryptedKey, order: OrderRequest): Promise<OrderResult>
  cancelOrder(key: DecryptedKey, id: VenueOrderId): Promise<void>
  closePosition(key: DecryptedKey, marketId: MarketId, size?: Decimal): Promise<OrderResult>

  // --- key lifecycle ---
  verifyDelegation(owner: Address, signer: Address): Promise<DelegationProof>

  // --- venue rules, so callers never hardcode them ---
  quantize(marketId: MarketId, price: Decimal, size: Decimal): QuantizedOrder
  constraints(marketId: MarketId): MarketConstraints  // tick, lot, min notional, max leverage
}
```

Two rules keep this honest:

- **`quantize` is not optional.** Every order goes through it. Venue tick/lot rules are the single most common source of silently rejected orders, and putting the rounding in the adapter means the copy engine never has to know that Hyperliquid prices carry at most 5 significant figures while Polymarket ticks in 0.001 probability increments.
- **Capabilities are declared, not assumed.** `constraints()` reports `maxLeverage: 1` and `supportsShort: false` for Polymarket. The copy planner reads capabilities rather than special-casing venues, so a leader running 20x perps gets sized into a 1x prediction-market position by arithmetic rather than by a conditional somebody forgot to write.

## 2. Hyperliquid

**Surfaces.** Two POST endpoints and a socket: `/info` (read-only, unauthenticated), `/exchange` (signed writes), and `wss://api.hyperliquid.xyz/ws`.

**Auth.** No API key/secret pair. Writes are signed by an **agent wallet** created via `approveAgent`, signed once by the master wallet and recorded on-chain. Agent wallets hold no funds and **cannot withdraw** — the property the entire security model rests on ([04](04-security-and-custody.md)). Agents can be named; re-approving the same name replaces the previous agent, which is our key-rotation mechanism.

**Streaming.** Subscribe `userFills` per address. The first message carries `isSnapshot: true`, subsequent ones `false` — the snapshot must be treated as a state reset, not as a burst of new trades, or a reconnect will double-count every historical fill. `orderUpdates` and `userEvents` overlap with `userFills`, so consuming more than one requires dedupe by fill id. **We consume `userFills` only**, and use the reconciler rather than a second feed for redundancy.

**Rate limits — the real constraint.**
- *Per IP:* aggregated weight of 1200/minute. Most `/info` calls weigh 20; `l2Book`, `allMids`, `clearinghouseState`, `orderStatus` weigh 2. Exchange actions weigh `1 + floor(batch_length / 40)`.
- *Per address:* **1 request per 1 USDC of cumulative lifetime volume**, after an initial 10,000-request buffer. Once exhausted, one request per 10 seconds.

Two consequences that shape the product:
1. The per-IP budget is shared by every user on an engine instance. Read via WebSocket, never poll. Share one market-data subscription across all users. Batch cancels (they get a more generous limit: `min(limit + 100000, limit * 2)`).
2. A brand-new small account can genuinely run out of actions. **This must be surfaced in the UI as a remaining-actions meter**, not discovered as a mysterious failure at 3am. It also means the planner should prefer fewer, larger corrections over many small ones.

**Markets.** Perps (cross or isolated, leverage up to venue max per asset) and spot. Sizes are asset-denominated with per-asset `szDecimals`; prices carry max 5 significant figures and no more than `6 - szDecimals` decimals. This is `quantize`'s job.

## 3. Polymarket

**Surfaces — four REST hosts and a socket, each with its own data model:**

| Surface | Purpose |
|---|---|
| **Gamma** | market and event metadata, slugs, resolution info |
| **CLOB** | order books, prices, order placement/cancel |
| **Data API** | on-chain positions, trades and portfolio value, keyed by proxy wallet address |
| **Leaderboard** | all-time PnL/volume rankings |
| **WSS** | `market` channel (book snapshot + deltas by token id), `user` channel (fills, needs API creds) |

**The V2 cutover is non-negotiable.** CLOB V2 went live 28 April 2026 (~11:00 UTC, ~1 hour of paused trading). V1-signed orders stopped working, all resting orders were wiped, and the V1 client packages are dead. Concretely:
- Signed order struct **drops** `taker`, `expiration`, `nonce`, `feeRateBps`; **adds** `timestamp`, `metadata`, `builder`.
- EIP-712 **Exchange** domain version bumped `"1"` → `"2"`.
- The **Auth** domain stayed at `"1"` — L1/L2 auth is unchanged, and existing apiKey/secret/passphrase still work.

Any tutorial, StackOverflow answer, or GitHub repo predating May 2026 is wrong about signing. The adapter must pin the V2 client and assert the domain version at startup.

**Two-layer auth.** L1 is a one-time EIP-712 wallet signature to `POST /auth/api-key`, returning `apiKey`, `secret`, `passphrase`. L2 is an HMAC-SHA256 over `timestamp + METHOD + path + body` on every authenticated request, using the L1-derived secret.

**Signature types.** `EOA` (0), `POLY_PROXY` (1, Magic/email), `POLY_GNOSIS_SAFE` (2, browser wallet), `POLY_1271` (3, deposit wallet). New integrations are steered to the **deposit-wallet flow**, where *signer and funder are different addresses* — the same shape as a Hyperliquid agent. Plain EOA flows are now rejected with "maker address not allowed, please use the deposit wallet flow".

**Known friction — flagged, not hidden.** The V2 TS/Python clients have open issues where POLY_1271 order placement fails because L1 auth binds the API key to the EOA rather than the deposit wallet. This is the single largest technical risk in the plan and is why a Phase 0 spike exists purely to place one real order end-to-end on Polymarket before any copy code is written. See [06](06-roadmap.md).

**Market shape.** Binary outcome shares priced 0–1. No leverage, no shorting (selling YES ≈ buying NO). Positions terminate in **resolution**, not just in a closing trade — a settled market pays out and the position vanishes, which the reconciler must not mistake for drift. Long-tail markets are genuinely illiquid; a $5k copy order into a thin book is the difference between a strategy and a donation.

## 4. Venue differences, in one table

The planner reads this table via `constraints()`; it is written here so a human reviewer can see what the code is absorbing.

| | Hyperliquid | Polymarket |
|---|---|---|
| Instrument | perpetual futures, spot | binary outcome shares |
| Price domain | asset price, unbounded | probability, 0.000–1.000 |
| Leverage | up to venue max, cross or isolated | none (1x always) |
| Short | native | via buying the opposite outcome |
| Position ends by | closing trade, liquidation | closing trade **or resolution** |
| Size units | asset units, `szDecimals` | shares, 6dp USDC notional |
| Liquidity | deep on majors | thin outside headline markets |
| Delegated key | agent wallet (`approveAgent`) | deposit-wallet session signer |
| Fills feed | `userFills` WS | `user` channel WS + Data API backfill |
| Copy latency tolerance | seconds matter | seconds matter *more* (chunkier fills) |
| Realistic copy quality | good on liquid perps | **poor on thin markets — gate hard** |

## 5. Money math

**Floats are banned in every path that touches an order.** Not a style preference — `0.1 + 0.2` in a size calculation becomes a rejected order at best and a wrong position at worst.

`packages/shared/money` provides a fixed-point `Decimal` (bigint mantissa + scale) with explicit rounding modes, and the codebase forbids `number` for money via a lint rule. Rules:
- Parse venue strings straight to `Decimal`; never through `parseFloat`.
- Rounding direction is always explicit and always conservative: sizes round **down** toward zero, prices round **away** from aggression (a buy limit rounds down, a sell limit rounds up) so quantization can never make an order more aggressive than intended.
- Every `Decimal` carries its scale; cross-venue arithmetic requires an explicit rescale.

## 6. Data model

Abbreviated; types are `Decimal` unless noted.

```
users(id, address, created_at, last_seen_at)
venue_accounts(id, user_id, venue, owner_address, signer_address, funder_address,
               status, verified_at)
encrypted_keys(id, venue_account_id, wrapped_dek, ciphertext, iv, tag,
               kms_key_id, created_at, rotated_at)     -- see 04
leaders(id, venue, address, label, first_indexed_at, last_event_at)
leader_fills(id, leader_id, venue_market_id, side, price, size, fee, ts, venue_fill_id UNIQUE)
leader_stats(leader_id, window, pnl, roi, win_rate, max_drawdown, avg_hold_secs,
             trade_count, computed_at)
subscriptions(id, user_id, leader_id, venue_account_id, sizing_mode, sizing_param,
              status, market_filter, created_at)       -- one follow
risk_profiles(id, user_id, subscription_id NULLABLE, max_notional_per_position,
              max_total_exposure, max_leverage, max_slippage_bps, max_signal_age_ms,
              max_position_pct_equity, daily_loss_limit)
order_intents(id, user_id, subscription_id NULLABLE, venue, market_id, side, size,
              price, kind, idempotency_key UNIQUE, status, venue_order_id, created_at)
fills(id, order_intent_id, venue_fill_id UNIQUE, price, size, fee, ts)
positions_snapshot(venue_account_id, market_id, size, entry_price, unrealized_pnl, ts)
decisions(id, user_id, subscription_id, kind, verdict, reason_code, detail jsonb, ts)
audit_log(id, user_id, action, ip, ts, detail jsonb)
```

Three deliberate choices:
- **`venue_fill_id UNIQUE`** on both fill tables. Exactly-once processing is enforced by the database, not by application care. A reconnect snapshot replaying 200 fills is then a no-op.
- **`idempotency_key UNIQUE`** on intents. The engine can crash between "decided" and "placed" and the retry cannot double-fill.
- **`decisions` is append-only** and is never deleted or updated. It is the audit trail, the debugging tool, and a user-facing feature at once.

## 7. Market data for the UI

The control plane reads market data directly from public venue endpoints for display, with a short server-side cache. It does **not** route through the engine — a slow dashboard must never be able to interfere with order execution, and vice versa. The cache respects the same per-IP budget accounting, since Vercel's egress IPs are shared but distinct from the engine's.
