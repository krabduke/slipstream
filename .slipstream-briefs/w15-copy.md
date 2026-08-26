# W15 — The copy planner

## Decision (already made — implement, do not revisit)

Implement `packages/copy`: `plan(ctx)` and `sizeFor(...)` per `packages/copy/src/types.ts` (fixed).

**The architecture is target-state reconciliation, not event replay.** Do not write anything that consumes a fill event and emits a proportional order. The algorithm is:

```
for each market the leader holds or we hold:
  desired = sizeFor(leaderPosition, sizing, leaderEquity, followerEquity)
  actual  = our current position
  delta   = desired - actual
  if |delta| <= toleranceBand: emit nothing
  else if desired is zero or shrinking toward zero: emit ExitIntent
  else: emit TradeIntent for the delta
```

`plan` is a **pure function** of `PlanContext` — same input, same output, no I/O, no clock. `ctx.now` is supplied.

Sizing modes (docs/03 §3): `equity_ratio` (default) is `leaderSize × followerEquity / leaderEquity × multiplier`; `fixed_notional`, `percent_equity`, `fixed_multiplier` as specified.

**`equity_ratio` fails closed when `leaderEquity` is null** — return null from `sizeFor` and have `plan` emit a `SkipDecision` with `leader_equity_unavailable`. Guessing a leader's equity to size a leveraged position is not acceptable.

Position reduction toward zero is an **exit**, not a trade, and goes in `Plan.exits`. Only increases and new positions go in `Plan.trades`. This is what keeps exits out of the risk gate.

## Files you own
```
packages/copy/src/{planner,sizing}.ts
packages/copy/src/__tests__/**
```

## Out of scope — do not edit
```
packages/copy/src/types.ts     Opus — fixed
packages/copy/src/index.ts     Opus — barrel
packages/risk/**               W14
packages/exec/**               W13
packages/testkit/**            W5 — use it, do not modify it
```

## Read first
`packages/copy/src/types.ts`, **`docs/03-copy-engine.md` §2, §3 and §5 in full**, `packages/testkit` for the simulator API.

## Definition of done
```bash
pnpm typecheck && pnpm test
```
Plus these scenario tests against `@slipstream/testkit`, which are the reason the package exists:
- **Missed event self-heals**: drop a fill from the stream; the next `plan` call still produces the correct correction.
- **Idempotent**: running `plan` twice against unchanged state produces one correction, then nothing.
- **Late join**: following a leader already holding a position produces a correct initial delta.
- **Tolerance band**: a dust-sized delta produces no intent at all.
- **Reduction produces an `ExitIntent`, not a `TradeIntent`.**
- All four sizing modes, with hand-computed expected values in comments.

## Known traps
- **Do not write an event-replay path, not even as an optimisation.** The whole design depends on events being only a hint to recompute. A "fast path" that applies a delta directly reintroduces the desync bug this architecture exists to eliminate.
- **A shrinking position is an exit.** If you route it as a trade it will be gated, and a gated exit is the failure mode docs/03 §5 exists to prevent.
- **The tolerance band is load-bearing.** Without it, funding and mark drift generate an endless trickle of dust orders that burn the per-address rate limit and pay fees for nothing.
- **`plan` must be pure.** No `Date.now()`, no venue calls.
- Cross-venue sizing uses the follower's equity **on that venue**. Polymarket collateral cannot back a Hyperliquid perp.
- Never `number` for money.
