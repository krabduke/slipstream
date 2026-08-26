# W16 — The engine process

## Decision (already made — implement, do not revisit)

Implement `apps/engine`: the long-lived Node process that is the actual bot. It cannot live on Vercel (docs/01 §1), so it is a plain process with a `Dockerfile`.

Cooperating loops in **one process**, not microservices, each a module under `apps/engine/src/`:

| Module | Responsibility |
|---|---|
| `leader-watcher` | one WS connection per venue, all leaders multiplexed and deduped; reconnect with backoff; a snapshot is a state reset |
| `copy-planner` | invoke `@slipstream/copy` on leader events **and** on the reconciler tick |
| `risk-gate` | `@slipstream/risk` on trades only |
| `executor` | `@slipstream/exec` |
| `reconciler` | every 15s, recompute every active subscription's target vs actual and emit corrections |
| `ledger` | append-only writes to `decisions` for every outcome, including skips |
| `health` | the checks below |

**Startup does not replay a log.** It reads open positions from both venues (the venue is the source of truth, never our DB), reads active subscriptions from Postgres, and reconciles. That is the whole recovery mechanism.

**Shard leases**: claim a range of users via the `engine_leases` table with a TTL and a heartbeat. A dead holder's lease expires before another instance may act.

**Dead-man's switch**: if Postgres or a venue is unreachable for longer than a threshold, stop opening new positions. An engine that cannot verify state must not act on assumptions. Exits keep working.

Health checks that mean something: WS connection age per venue, seconds since last leader event, reconciler drift magnitude, oldest unconsumed stream entry, per-user remaining rate budget. A check that only proves the process is alive is worse than none.

## Files you own
```
apps/engine/**
```
You may create `apps/engine/package.json` — it is yours alone.

## Out of scope — do not edit
```
packages/**        every one is another worker's; consume them
apps/web/**        W10/W17/W18 and Opus
infra/**           W4
```

## Read first
**`docs/01-architecture.md` §2 and §3 in full**, `docs/03-copy-engine.md` §6 (the failure table is your scenario list), `docs/04-security-and-custody.md` §6 (kill switches).

## Definition of done
```bash
pnpm typecheck && pnpm test
```
Plus the full scenario suite against `@slipstream/testkit`, covering every row of the docs/03 §6 failure table, and specifically:
- **Kill and restart mid-sequence → reconciles to correct state with no duplicate orders.**
- A dropped WS reconnects, receives a snapshot, and does **not** double-count.
- A kill switch halts opening while exits still process.
- The dead-man's switch fires when Postgres is unreachable.

## Known traps
- **Never gate an exit.** Route `Plan.exits` straight to the executor. The types prevent it; do not work around them.
- **A reconnect snapshot is a state reset.** Handle `isSnapshot` explicitly.
- **The kill switch must be re-read every tick**, from both Redis and Postgres, and "either says stop" means stop.
- **Do not swallow errors to keep the loop alive.** A caught-and-ignored exception in an order path is how positions silently go wrong. Log, alarm, and stop opening if you cannot proceed safely.
- Redis holds only losable state. Postgres is durable truth. Never invert that.
- Do not add a "fast path" that bypasses the reconciler.
