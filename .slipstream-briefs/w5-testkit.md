# W5 — Venue simulator and fixture recorder

Before writing any code, work through the Known traps below and state your plan. Then implement.

## Decision (already made — implement, do not revisit)

You cannot develop a copy engine against mainnet, and testnet has no whales to copy. So the engine is developed against a **deterministic simulator that replays recorded fill streams**. This package is what makes every later wave testable, which is why it is in Wave 1 rather than alongside the engine.

Build three things.

**1. `createSimulatedVenue(fixture, options)`** returning a full `VenueAdapter` (the interface in `packages/venues/src/types.ts`, which is fixed). It serves markets, books, positions, fills and account values from a fixture file, and `watchFills` / `watchBook` yield the fixture's events in recorded order. Given the same fixture and the same options it must produce byte-identical output across runs — no wall-clock reads, no `Math.random`, no `Date.now()`. Time is supplied by the fixture and advanced by the harness.

**2. A fixture format and loader.** JSON, with a version field. It holds: markets with their constraints, an ordered event list (fills, book deltas, position snapshots), and per-address account values over time. Write a small schema for it with zod and validate on load — a malformed fixture must fail loudly, not produce a subtly wrong test.

**3. `scripts/record-fixture.ts`** — a recorder that connects to a real venue read-only and writes a fixture. It takes a venue, an address, and a duration. It must be runnable with no credentials, because it only uses public read endpoints.

Also provide a **scenario harness**: given a fixture and a sequence of assertions, step the simulator event by event so later waves can express "the socket drops here", "this fill is delivered twice", "a snapshot arrives mid-stream".

## Files you own

```
packages/testkit/**
scripts/record-fixture.ts
```

## Out of scope — do not edit

```
packages/venues/src/types.ts      Opus — the interface you implement against
packages/venues/src/**            W6/W7/W11/W12 — do not implement real adapters
packages/shared/**                W1/W3 and Opus
packages/db/**                    W2
infra/**                          W4
```

## Read first

- `packages/venues/src/types.ts` in full
- `docs/03-copy-engine.md` §6 (the failure table — every row there eventually becomes a scenario)
- `docs/02-venues-and-data.md` §2 and §3 for what real event streams look like

## Definition of done

```bash
pnpm typecheck    # exit 0
pnpm test         # exit 0
```

Plus the observable, which is the whole point: **a test that replays the same fixture twice and asserts the two output sequences are deeply equal.** Non-determinism here silently poisons every later wave's test suite, so this test is not optional.

Include at least one committed fixture, hand-written rather than recorded, exercising: an opening fill, a partial fill, a reducing fill, a closing fill, and a Polymarket market resolution.

## Known traps

- **`Date.now()`, `Math.random()`, `new Date()` and `crypto.randomUUID()` are banned in this package.** All four break replay determinism. Ids come from the fixture or a seeded counter; time comes from the fixture.
- **The first message of a real `watchFills` subscription is a SNAPSHOT and is a state reset, not a burst of new fills.** The simulator must be able to emit snapshots so later waves can test that the engine handles them correctly — this is the exact bug that desynchronises naive copy bots forever. Model it explicitly with the `isSnapshot` flag.
- **A Polymarket position can end by *resolution*, not only by a closing trade.** These are different events with different downstream handling and the fixture format must distinguish them. Do not model resolution as a trade.
- Object key order affects deep-equality serialisation in some comparisons. Sort keys when writing fixtures.
- Do not implement real network calls in this package. The recorder script is the only thing that touches a network, and it is read-only and credential-free.
- Do not use floats in the fixture format. Money is strings, parsed with `money.parse`.
