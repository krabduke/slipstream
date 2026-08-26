# W11 — Hyperliquid write path

## Decision (already made — implement, do not revisit)

Implement `placeOrder`, `cancelOrder`, `closePosition` for Hyperliquid in `packages/venues/src/hyperliquid/write.ts`, and wire them into the adapter object in `index.ts` (replacing only those three stubs — leave W6's read methods alone).

Signing: EIP-712 actions POSTed to `https://api.hyperliquid.xyz/exchange`, signed by the **agent wallet** key. Obtain the key only via the `SignerKey` passed in — use `revealSignerKey` from `@slipstream/shared` at the single signing call site and nowhere else.

Nonces must be strictly increasing per agent address. Maintain an in-process monotonic counter seeded from `Date.now()` at construction, and never emit the same nonce twice even under concurrent calls.

`order.clientId` (our `IdempotencyKey`) maps to the venue's client order id so a retry is recognised as the same order rather than placed twice.

`closePosition` with `size === null` closes the whole position and must be **reduce-only**.

A `builderCode` config value is threaded through and ships **empty and disabled**. Implement the plumbing; do not enable it, do not invent a code.

## Files you own
```
packages/venues/src/hyperliquid/write.ts
packages/venues/src/hyperliquid/sign.ts
packages/venues/src/hyperliquid/__tests__/write*.test.ts
```
You may edit ONLY the three write method lines in `packages/venues/src/hyperliquid/index.ts`.

## Out of scope — do not edit
```
packages/venues/src/types.ts               Opus — fixed
packages/venues/src/hyperliquid/{read,quantize,ws}.ts   W6
packages/venues/src/polymarket/**          W12
packages/vault/**                          W8
```

## Read first
`packages/venues/src/types.ts`, `packages/shared/src/secret.ts`, `docs/02-venues-and-data.md` §2, `docs/03-copy-engine.md` §5 (why exits execute aggressively).

## Definition of done
```bash
pnpm typecheck && pnpm test
```
Plus the observable: place and then cancel a real order on **testnet** (`https://api.hyperliquid-testnet.xyz`). If you have no testnet credentials, say so plainly and prove correctness with signature-fixture tests instead — assert your EIP-712 digest matches a known-good vector. **Do not claim you placed an order you did not place.**

## Known traps
- **Every order goes through `quantize` first.** Tick/lot violations are the most common silent rejection. Do not submit a raw size.
- **Nonce reuse is rejected by the venue and looks like a random failure.** Concurrency here is real — the executor may call you from several tasks at once.
- **`revealSignerKey` exactly once, at the signing call.** Never assign it to a variable that outlives the call, never log it, never include it in an error.
- **Exits are aggressive by default** — IOC or market, not a passive limit. A partially filled exit is worse than a slightly worse price.
- Reduce-only must actually be set on closes. Without it a "close" can flip the position to the other side.
- Do not retry a rejected order with a nudged size. A rejection is a bug signal; surface it.
