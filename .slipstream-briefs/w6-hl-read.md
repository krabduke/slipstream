# W6 — Hyperliquid read adapter

## Decision (already made — implement, do not revisit)

Implement the read half of `VenueAdapter` for Hyperliquid against `packages/venues/src/types.ts`, which is fixed. Replace the throwing stubs in `packages/venues/src/hyperliquid/index.ts` — keep that file as the assembled adapter and put real code in sibling files (`read.ts`, `quantize.ts`, `ws.ts`).

Use the `@nktkas/hyperliquid` SDK. It is **not yet installed** — if it is missing, implement directly against the HTTP/WS API with `fetch` and the built-in `WebSocket`, and say so in your final message. Do not edit `package.json`.

Endpoints: `POST https://api.hyperliquid.xyz/info` for all reads (no auth), `wss://api.hyperliquid.xyz/ws` for streams.

Mapping:
| Adapter method | Source |
|---|---|
| `listMarkets` | `meta` + `spotMeta` |
| `getBook` | `l2Book` (weight 2) |
| `getPositions`, `getAccountValue` | `clearinghouseState` (weight 2) |
| `getFills` | `userFillsByTime` |
| `watchFills` | WS `userFills` subscription |
| `watchBook` | WS `l2Book` subscription |
| `constraints` | from `meta` — `szDecimals` per asset |
| `rateBudget` | `userRateLimit` |

`quantize`: sizes round to the asset's `szDecimals` with `trunc`. Prices carry at most 5 significant figures and at most `6 - szDecimals` decimals; round **away from aggression** — a buy limit rounds down (`floor`), a sell limit rounds up (`ceil`).

`verifyDelegation(owner, signer)`: query the owner's registered agents via `extraAgents`, confirm `signer` appears and is not `owner`, return a `DelegationProof` with `method` describing exactly what was checked. **Any error is a rejection, never a warning — fail closed.**

## Files you own
```
packages/venues/src/hyperliquid/**   (except write.ts — that is W11)
```

## Out of scope — do not edit
```
packages/venues/src/types.ts        Opus — fixed
packages/venues/src/index.ts        Opus — barrel
packages/venues/src/hyperliquid/write.ts   W11 (wave 3)
packages/venues/src/polymarket/**   W7
packages/shared/**                  W1/W3
```

## Read first
`packages/venues/src/types.ts` in full; `docs/02-venues-and-data.md` §1, §2, §4, §5.

## Definition of done
```bash
pnpm typecheck && pnpm test
```
Plus the observable: `getPositions` and `getAccountValue` return correct live values for a real address, hand-checked against app.hyperliquid.xyz. `/info` needs no credentials, so you can and should make real read-only requests.

## Known traps
- **`userFills`' first WS message is `isSnapshot: true` and is a STATE RESET, not new fills.** Treating it as new fills double-counts all history on every reconnect. This is the bug that permanently desynchronises naive copy bots.
- **Rate limits are real and shared.** 1200 weight/min per IP. Most `/info` calls weigh 20; `l2Book`/`clearinghouseState`/`allMids`/`orderStatus` weigh 2. Prefer the cheap ones, read via WS, never poll in a loop.
- **Never `number` for money, never `parseFloat`.** Parse venue strings with `money.parse` from `@slipstream/shared`.
- Price rounding direction depends on side. Getting it backwards makes orders more aggressive than intended — the one thing quantization must never do.
- Do not implement `placeOrder`/`cancelOrder`/`closePosition`. They stay stubs until W11.
- `constraints()` is synchronous in the interface. Cache `meta` at construction; do not make it do I/O.
