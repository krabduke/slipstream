# W17 — Control-plane API routes

## Decision (already made — implement, do not revisit)

Implement the non-auth route handlers in `apps/web/src/app/api/**`.

**The control plane never places an order.** It writes *intent* and reads state (docs/01 §1). A manual order becomes a row plus a Redis stream entry, and returns `202 Accepted` with the intent id. The engine does the rest. There is no RPC from web to engine.

Routes:
- `POST /api/orders` — validate with zod, run a **fast DB-only risk pre-check** for instant feedback, insert `order_intents`, `XADD` to the intents stream, return 202. The engine re-checks authoritatively; your check is UX, not enforcement.
- `GET /api/positions`, `GET /api/orders`, `GET /api/fills`
- `GET /api/decisions` — the activity ledger, filterable by verdict, leader, venue, market
- `POST /api/keys` — accepts a browser-generated agent key. **Calls `verifyDelegation` BEFORE storing anything.** Fails closed: verification error means 400 and nothing written. Requires a fresh step-up signature.
- `GET/POST /api/subscriptions`, `GET/PUT /api/risk-profile` — both require step-up for any change that increases exposure
- `POST /api/kill` — per-subscription, per-user, with an explicit `flatten` boolean
- `GET /api/leaders/:address` — trader profile stats
- `GET /api/stream` — SSE, fed by Postgres `LISTEN/NOTIFY` on ledger inserts

Every route: zod-validated input, `requireUser` from W10, and **tenant-scoped queries only**.

## Files you own
```
apps/web/src/app/api/**    (except api/auth/** which is W10's)
```

## Out of scope — do not edit
```
apps/web/src/app/api/auth/**    W10
apps/web/src/components/**      Opus — the entire frontend
apps/web/src/app/(app)/**       Opus
apps/web/src/lib/**             W18
any package.json
```

**Do not build any UI.** Route handlers only — no pages, no components, no styling.

## Read first
`docs/01-architecture.md` §2, `docs/04-security-and-custody.md` §5, `packages/db/src/schema.ts`.

## Definition of done
```bash
pnpm typecheck && pnpm test
```
Plus tests proving: an unauthenticated request is rejected; a request for another user's data returns nothing (not an error revealing existence); `POST /api/keys` with an unverifiable delegation stores nothing; a risk-limit increase without a fresh signature is rejected.

## Known traps
- **`POST /api/keys` must never store a key it could not verify.** Fail closed. Do not store-then-verify, and do not treat a network error during verification as a pass.
- **Tenant scoping happens in the data layer**, not here. Never write raw SQL; use W2's helpers which require an explicit `userId`.
- **The web tier has no KMS decrypt permission and must not attempt decryption.** If you need a plaintext key, the design is wrong.
- Do not log request bodies. They contain key material on `/api/keys`.
- 202, not 200, for order intake — the order has not been placed when you respond, and pretending otherwise is a lie the UI will repeat.
- Do not add a route that lets the web tier bypass the engine and hit a venue directly.
