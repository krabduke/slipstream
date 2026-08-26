# W12 — Polymarket write path

## Decision (already made — implement, do not revisit)

Implement `placeOrder`, `cancelOrder`, `closePosition` for Polymarket in `packages/venues/src/polymarket/write.ts`, wired into `index.ts` (replacing only those three stubs).

**Read `docs/spikes/s1-polymarket-v2.md` first.** A spike ran specifically to determine whether deposit-wallet (POLY_1271) order placement is viable. If its verdict is `BLOCKED`, implement what is possible, leave the blocked path throwing a clear error naming the spike, and say so in your final message. Do not fight a known-blocked flow.

CLOB **V2 only**. Concretely:
- Order struct **drops** `taker`, `expiration`, `nonce`, `feeRateBps`; **adds** `timestamp`, `metadata`, `builder`.
- EIP-712 **Exchange** domain version is `"2"`. The **Auth** domain stays `"1"`.
- **Assert the Exchange domain version at construction** and throw if it is not `"2"`. A silent V1 signature is rejected by the venue in a way that looks like an auth problem.

Two auth layers: L1 (one-time EIP-712 signature producing apiKey/secret/passphrase) and L2 (HMAC-SHA256 over `timestamp + METHOD + path + body` on every authenticated request).

`closePosition` sells the held outcome token. There is no short: selling YES is buying NO, which is a different `MarketId`.

## Files you own
```
packages/venues/src/polymarket/write.ts
packages/venues/src/polymarket/{sign,auth}.ts
packages/venues/src/polymarket/__tests__/write*.test.ts
```
You may edit ONLY the three write method lines in `packages/venues/src/polymarket/index.ts`.

## Out of scope — do not edit
```
packages/venues/src/types.ts                   Opus — fixed
packages/venues/src/polymarket/{read,quantize}.ts   W7
packages/venues/src/hyperliquid/**             W11
docs/spikes/**                                 read only
```

## Read first
`docs/spikes/s1-polymarket-v2.md` (the verdict governs your approach), `packages/venues/src/types.ts`, `docs/02-venues-and-data.md` §3.

## Definition of done
```bash
pnpm typecheck && pnpm test
```
Plus: a test asserting the Exchange domain version is `"2"` and that construction throws if it is not. If you cannot place a real order (no credentials, or the spike says blocked), say so explicitly — **do not report an order you did not place**.

## Known traps
- **Anything predating May 2026 is wrong about signing.** Check the date on every source you rely on.
- **`clob-client` v5 and `clob-client-v2` are different packages.** Using the wrong one produces valid-looking signatures the venue rejects.
- **Signer ≠ funder ≠ owner.** The signer signs; the funder holds; only the owner withdraws. Getting these crossed is the documented cause of the open POLY_1271 issues.
- **L2 HMAC is over `timestamp + METHOD + path + body` in that exact order**, with the path including the query string. An off-by-one in the concatenation produces a 401 that looks like a bad key.
- Timestamps are seconds, not milliseconds, in the L2 signature.
- No leverage, no shorting, prices are 0.000–1.000 on a 0.001 tick.
