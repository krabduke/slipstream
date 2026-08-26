# W9 — Leader indexing and trader statistics

## Decision (already made — implement, do not revisit)

Implement `packages/tracker`: index a leader's fills into `leader_fills`, and compute `leader_stats`.

Two entry points:
- `backfill(venue, address, since)` — REST history via the venue adapter's `getFills`, inserted idempotently.
- `watch(venue, addresses)` — live via `watchFills`, same insert path.

Both write through W2's query helpers. **Insertion must be idempotent**: `leader_fills.venue_fill_id` is UNIQUE, so use an on-conflict-do-nothing insert. A reconnect snapshot replaying 200 fills must be a no-op, not 200 duplicates or an exception.

Statistics per window (`24h`, `7d`, `30d`, `all`): `pnl`, `roi`, `winRate`, `maxDrawdown`, `avgHoldSecs`, `tradeCount`.

Compute them from fills by reconstructing round-trips: pair opening fills with closing fills per market, FIFO. A round-trip's PnL is realised proceeds minus cost minus fees. `maxDrawdown` is the largest peak-to-trough decline of the cumulative realised PnL curve. `avgHoldSecs` is the mean time from open to close of completed round-trips only — never count still-open positions as zero-length, which would flatter every leader.

## Files you own
```
packages/tracker/**
```

## Out of scope — do not edit
```
packages/db/**            W2 — use its query helpers, do not write raw SQL
packages/venues/**        W6/W7 — consume the adapter interface
packages/shared/**        W1/W3
```

## Read first
`packages/venues/src/types.ts`, `packages/db/src/schema.ts`, `docs/02-venues-and-data.md` §6, `docs/05-frontend.md` §3 (the Traders section explains what these numbers are for).

## Definition of done
```bash
pnpm typecheck && pnpm test
```
Plus: tests using `@slipstream/testkit`'s simulator with a hand-built fixture where you know the right answer by hand — a leader who opens, partially closes, fully closes, and wins twice and loses once. Assert every statistic against numbers you computed manually and wrote in a comment.

## Known traps
- **Statistics must be pessimistic, not flattering.** `maxDrawdown` and losing streaks get the same weight as returns. The failure mode of every copy-trading UI is making a lucky wallet look like a genius; do not contribute to it by, say, excluding open losing positions from drawdown.
- **Fees are part of PnL.** A strategy that is profitable before fees and unprofitable after is unprofitable.
- **A Polymarket position can end by resolution, not a closing trade.** A resolved market settles. Do not leave those round-trips permanently open, and do not treat settlement as a trade with zero PnL.
- **Never `number` for money.** Every statistic is computed in `Decimal`. `winRate` and `roi` are ratios but they are still `Decimal` — the schema column is `numeric`.
- Do not call the venue in a tight loop for backfill. Respect rate limits; page and batch.
- Insert with on-conflict-do-nothing. Do not "check then insert" — that races.
