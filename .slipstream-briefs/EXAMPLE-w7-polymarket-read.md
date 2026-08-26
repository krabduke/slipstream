# W7 — Polymarket read adapter

*(Reference brief. Shows the exact format every worker brief in this directory must follow. See docs/08 §6.)*

Before writing any code, work through the Known traps below and state your plan. Then implement.

## Decision (already made — implement, do not revisit)

Implement the read half of `VenueAdapter` for Polymarket against the interface Opus has already written in `packages/venues/src/types.ts`. Do not modify that interface. If it appears wrong, stop and say so in your final message rather than changing it.

Polymarket exposes four REST surfaces with four different data models plus a WebSocket. Map them as follows, and do not substitute one for another:

| Adapter method | Source |
|---|---|
| `listMarkets` | Gamma (metadata, slugs, resolution criteria) |
| `getBook` | CLOB |
| `getPositions`, `getAccountValue` | Data API, keyed by proxy wallet address |
| `getFills` | Data API `GET /trades`, filtered by user |
| `watchFills` | WSS `user` channel |
| `watchBook` | WSS `market` channel, subscribed by token id |
| `constraints` | static per docs/02 §4 — `maxLeverage: 1`, `supportsShort: false` |

`quantize` rounds prices to the venue's 0.001 probability tick and sizes to 6dp. Rounding direction is not a free choice: **sizes round down toward zero; prices round away from aggression** (a buy limit rounds down, a sell limit rounds up), so quantization can never make an order more aggressive than intended. docs/02 §5.

## Files you own

```
packages/venues/src/polymarket/read.ts
packages/venues/src/polymarket/quantize.ts
packages/venues/src/polymarket/__tests__/**
```

## Out of scope — other workers own these, do not edit

```
packages/venues/src/types.ts          Opus — the interface you implement
packages/venues/src/index.ts          Opus — barrel, already exports your files
packages/venues/src/polymarket/write.ts   W12 — writes land in wave 3, not now
packages/venues/src/hyperliquid/**    W6
packages/shared/src/money/**          W1
packages/db/**                        W2
```

## Read first

- `docs/02-venues-and-data.md` §1, §3, §4, §5 — the adapter seam, Polymarket surfaces, venue differences, money math
- `packages/venues/src/types.ts` — the interface, which is fixed

Attach both to your context in full; do not work from excerpts.

## Definition of done

```bash
pnpm test venues/polymarket    # green
pnpm typecheck                 # green
pnpm lint                      # green
```

Plus the observable: `getPositions` and `getAccountValue` return correct live values for a known Polymarket address, hand-checked against what polymarket.com displays for that same address.

## Known traps

- **CLOB V2 only.** V2 went live 28 April 2026; V1 signing is dead and all V1 resting orders were wiped. Any documentation, tutorial, or example dated before May 2026 is wrong. Pin `@polymarket/clob-client-v2`.
- **Four hosts, four data models.** Gamma ≠ CLOB ≠ Data API ≠ Leaderboard. A market id in one is not necessarily the identifier used by another. Do not assume they interchange.
- **Never `number` for money. Never `parseFloat`.** Parse venue strings straight to `Decimal` from `packages/shared/money`. A lint rule enforces this; do not suppress it.
- **"Signer", "owner" and "funder" are three different addresses** on Polymarket. Positions are keyed by the *proxy/deposit wallet*, not by the signer. Getting this wrong returns an empty portfolio for a funded account and looks like an API bug.
- **A position can end by *resolution*, not only by a closing trade.** Read paths must expose market status so callers can tell the two apart. Do not model resolution as a trade.
- **Long-tail markets are genuinely illiquid.** `getBook` must return real depth, not a top-of-book summary — a caller sizing an order needs to see how thin it is.
