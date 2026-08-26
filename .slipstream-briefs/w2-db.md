# W2 — Database migrations and typed queries

Before writing any code, work through the Known traps below and state your plan. Then implement.

## Decision (already made — implement, do not revisit)

The schema in `packages/db/src/schema.ts` is fixed. Do not add, rename, or remove tables or columns. Your job is (a) generate and commit Drizzle migrations for it, (b) implement `createDb` in `packages/db/src/client.ts`, and (c) write the typed query helpers.

**Every query helper takes an explicit `userId` as its first parameter.** There is no unscoped helper, and you must not create one — not even a private one that a scoped helper wraps. Tenant scoping is enforced at the data-access layer, not in route handlers, precisely so a future caller cannot forget. See docs/04 §5.

Money columns are `numeric(38,18)` and are read and written as **strings**. Do not parse them to `number` anywhere. Query helpers return the raw string; callers convert with `money.parse` from `@slipstream/shared`.

`drizzle-kit` and the `db:generate` / `db:migrate` scripts are already present at the root. Do not edit the root `package.json`.

## Files you own

```
packages/db/src/client.ts
packages/db/src/queries/**
packages/db/drizzle.config.ts
packages/db/migrations/**
packages/db/src/__tests__/**
```

Do not edit any `package.json`. Every dependency you need is already installed.

## Out of scope — do not edit

```
packages/db/src/schema.ts     Opus — fixed; if it looks wrong, stop and say so
packages/db/src/index.ts      Opus — the barrel
packages/shared/**            W1 and Opus
apps/**                       later waves
```

## Read first

- `packages/db/src/schema.ts` — the doc comments state which constraints enforce which engine invariant
- `docs/02-venues-and-data.md` §6
- `docs/04-security-and-custody.md` §5

## Definition of done

```bash
pnpm typecheck    # exit 0
pnpm test         # exit 0
pnpm db:generate  # produces migrations with no diff on a second run
```

Plus the observable: migrations apply cleanly to an empty Postgres 16 and the resulting database has every unique index named in the schema. Prove it with a test that runs the migrations against a throwaway database and then asserts the indexes exist by querying `pg_indexes`.

Postgres is not installed on this machine and Docker is not available. If you cannot reach a Postgres instance, write the test so it skips with a clear message when `DATABASE_URL` is unset, and say plainly in your final message that you could not run it.

## Known traps

- **The unique indexes are load-bearing, not decorative.** `fills.venue_fill_id` and `leader_fills.venue_fill_id` are what make a WebSocket reconnect snapshot a no-op instead of 200 duplicated fills. `order_intents.idempotency_key` is what makes a crash between "decided" and "placed" safe to retry. Do not relax, rename, or make any of them partial.
- **`decisions` and `audit_log` are append-only.** Write inserts and reads. Do not write an update or delete helper for them, even as a convenience.
- **`owner_address`, `signer_address` and `funder_address` are three different addresses.** Positions are keyed by the funder on Polymarket, orders are signed by the signer, and only the owner can withdraw. Never write a helper that treats them as interchangeable.
- **`subscriptions.is_paper` defaults to true.** Do not add a code path that flips it as a side effect of anything.
- Addresses are stored lowercase. Normalise on write; never rely on the caller.
- Drizzle's `numeric` returns a string. If you see a `number` come out of a money column, something is wrong — do not "fix" it with a cast.
