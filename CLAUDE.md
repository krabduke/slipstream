# Slipstream — agent guide

Copy trading and trader intelligence for Hyperliquid and Polymarket. Live at
https://slipstream.k2capitalmanagement.xyz. Design: `PLAN.md` + `docs/0*.md`.
What exists, departures from the plan, and operations: **`docs/BUILD.md`** (read first).

## Hard rules

- The agent fleet is retired (its dispatcher was removed); build directly.
- **Only trade-only keys.** Nothing may store a key without `verifyDelegation` passing first. The web
  server never sees a plaintext key (the browser seals it to the engine's public key).
- **Exits are never gated.** `ExitIntent` must never reach the risk gate; kill switches cause exits, never block them.
- **No floats in order paths** (`money` package). Analytics in `packages/intel` may use numbers.
- **Every table gets RLS** (Supabase exposes `public` over REST). `packages/db/src/__tests__/rls.test.ts` enforces it.
- **Never disable TLS verification**; the Supabase root CA is pinned in `packages/db/src/tls.ts`.
- **Live Polymarket trading is out of scope** until the owner says otherwise (geoblocked; no VPN workarounds).
- Live trading is allowlisted (`LIVE_OWNER_ADDRESSES`); public users get intelligence + paper only.

## Commands

- `pnpm typecheck && pnpm test` — the gate for any change
- `node apps/engine/build.mjs` — bundle the engine (single ESM file, no node_modules needed)
- `vercel deploy --prod --yes` — deploy the site (Vercel account k2man1)
- `DATABASE_URL=$POSTGRES_URL_NON_POOLING pnpm db:migrate` — apply migrations (env from `.env.local`)
- `scripts/e2e-*.ts` — end-to-end checks against real data (clean up test users afterwards)
