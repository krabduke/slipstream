# W13 — Executor: idempotency, locking, retries

## Decision (already made — implement, do not revisit)

Implement `packages/exec`: the single code path through which every order reaches a venue. Copy trades and manual trades both go through it (docs/03 §8).

`execute(intent, deps)` where `intent` is a `TradeIntent` or `ExitIntent`:
1. Acquire a **per-user, per-venue lock** (Redis `SET NX PX` with a TTL and a random token; release only if the token still matches). Two engine instances must never act for one user at once.
2. Insert the `order_intents` row with its `idempotencyKey`. **Unique-violation means this intent was already placed — return the existing row, do not place again.** This is what makes a crash between "decided" and "placed" safe.
3. `withKey` from the vault → `venue.quantize` → `venue.placeOrder`.
4. Record the result and any fills. Release the lock.

Retry policy: retry only on transport errors and explicit rate limits, with exponential backoff and jitter, at most 3 attempts. **Never retry a venue rejection** — a rejection is a bug signal, not a transient.

Exits take a distinct path that skips the risk gate entirely and defaults to aggressive execution (IOC/market). The type system already prevents an `ExitIntent` reaching a gate; do not add a call that would.

## Files you own
```
packages/exec/**
```

## Out of scope — do not edit
```
packages/risk/**       W14 — call it, do not modify it
packages/venues/**     W6/W7/W11/W12
packages/vault/**      W8
packages/db/**         W2 — use its helpers
```

## Read first
`packages/shared/src/contracts/intents.ts`, `packages/vault/src/types.ts`, `docs/03-copy-engine.md` §5 and §6 (the failure table is your test list), `docs/01-architecture.md` §2.

## Definition of done
```bash
pnpm typecheck && pnpm test
```
Plus tests, against the simulator, proving:
- The same `idempotencyKey` submitted twice places **one** order.
- A crash simulated between intent insert and `placeOrder` results in no duplicate on retry.
- A held lock blocks a second concurrent execute for the same user, and is released on both success and throw.
- A rate-limit error retries with backoff; a venue rejection does **not** retry.
- An `ExitIntent` executes without consulting the risk gate.

## Known traps
- **Release the lock in a `finally`, and only if you still hold it.** Releasing another holder's lock after your TTL expired is worse than never locking.
- **The unique-violation path is the happy path, not an error.** Catch it specifically by constraint name; do not catch all errors and assume duplication.
- **Never log the `SignerKey`, and never widen it outside `withKey`'s callback.**
- Do not swallow errors to keep the loop alive. An unhandled venue error must surface — silent failure in an order path is how positions go wrong unnoticed.
- Every money value is `Decimal`. No floats.
