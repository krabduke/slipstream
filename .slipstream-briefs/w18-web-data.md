# W18 — Web data layer and SSE client

## Decision (already made — implement, do not revisit)

Implement `apps/web/src/lib/**`: typed data access and the live-update client that the (separately built) UI consumes.

- Typed fetch wrappers over W17's routes, sharing zod schemas from `@slipstream/shared` — no duplicated response types.
- React Server Component data functions for the dashboard's initial load.
- An **SSE client** for `/api/stream` that reconnects automatically and **backfills the gap by timestamp** on reconnect.
- A `useStaleness` hook exposing how old the data is, so the UI can visibly de-emphasise stale numbers.

**Reconnection is normal, not exceptional.** Vercel caps a connection at 5 minutes, so a long-lived session will reconnect many times per hour. Treat it as the steady state: no error toast, no flicker, no lost events.

## Files you own
```
apps/web/src/lib/**    (except lib/auth/** which is W10's)
```

## Out of scope — do not edit
```
apps/web/src/lib/auth/**        W10
apps/web/src/components/**      Opus — the entire frontend
apps/web/src/app/**             W10/W17 and Opus
any package.json
```

**Do not build any UI.** No components, no JSX beyond a hook's return value, no styling, no copy. Hooks and functions only.

## Read first
`docs/05-frontend.md` §4 and §5, `docs/01-architecture.md` §1.

## Definition of done
```bash
pnpm typecheck && pnpm test
```
Plus tests proving: a forced disconnect reconnects and backfills by timestamp without duplicating or dropping events; `useStaleness` reports increasing age when no events arrive.

## Known traps
- **Backfill by timestamp, not by "reconnect and hope".** Events during the gap are exactly the ones a user needs — a skipped copy decision they will otherwise never see.
- **Deduplicate on backfill.** Overlapping windows will re-deliver events; the ledger id is your key.
- **Stale data must be detectable by the UI.** A dashboard confidently rendering a five-minute-old position is worse than one admitting it does not know. Expose the age; do not hide it.
- Exponential backoff on reconnect, with a cap. A tight reconnect loop against a downed engine is a self-inflicted outage.
- Do not invent client-side state that duplicates server truth. Positions come from the server, always.
