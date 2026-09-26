# Build log and plan (solo build, from 2026-09-26)

The agent fleet described in `08-build-fleet.md` is retired and its dispatcher
has been removed from the repo. Everything below is built directly.

## Scope agreed with the owner (2026-09-26)

In order:
1. **Trader intelligence** for Hyperliquid and Polymarket: find and profile the
   best wallets from public data, with an honest, decomposed skill score and
   explicit "why you can't copy this" flags.
2. **Hyperliquid copy trading**: paper first, then live on the owner's own
   wallet via a trade-only agent key.
3. **Polymarket copy trading**: paper + alerts. **Live Polymarket trading is out
   of scope for now** — Polymarket geoblocks both the owner (Italy) and the
   engine host (Germany); the owner will decide at the very end. No VPN
   workarounds.

Hosting: web on Vercel (`k2man1` account, project `slipstream`) at
`slipstream.k2capitalmanagement.xyz`; engine on the owner's VPS as a plain Node
22 process (`~/.local/node`), no Docker; Postgres on Supabase via the Vercel
Marketplace (`slipstream-db`, us-east-1). Public: intelligence + paper. Live
copy trading: owner's wallets only (allowlist), pending legal advice before
opening it to anyone else (docs/04 §7).

## Deliberate departures from the original plan

- **Rankings.** docs/03 §10 and docs/04 §7 said "no rankings". The owner wants a
  discovery surface. It ships as sortable *statistics* with every score
  component shown, a "not advice" note, and flags that downgrade lucky or
  uncopyable wallets — not as recommendations.
- **No Redis in v1.** One engine instance; intents, kill switches and nonces
  live in Postgres. `REDIS_URL` is optional.
- **Key custody.** `KMS_PROVIDER=local` on the VPS (no cloud KMS account). The
  web app never holds the master key: it seals submitted agent keys to the
  engine's public key, and only the engine can open and re-wrap them.
- **TLS.** Supabase's root CA is pinned in `packages/db/src/tls.ts`; verification
  is never disabled.
- **RLS.** Every table has row-level security enabled with no policies, which
  closes Supabase's public REST API; enforced by `packages/db/src/__tests__/rls.test.ts`.

## Checklist

- [x] Move out of `k2capital/`, repair worktrees
- [x] Vercel project (k2man1) + Supabase via Marketplace; migrations; REST path closed (RLS on every table)
- [x] `packages/intel`: metrics (time-weighted drawdown, round trips, consistency), decomposed score, copy flags
- [x] Hyperliquid + Polymarket profilers; engine intel job (6h per venue, batched writes, resumable, scheduled from last finished run)
- [x] Web: Traders (per venue), profiles, method, landing; live status band from the engine heartbeat
- [x] Auth: SIWE sessions (single-use nonces, replay refused)
- [x] Copy planner + sizing (fail closed), risk gates (existing), paper executor (walks live books, pessimistic)
- [x] Hyperliquid order placement via SDK + viem (hand-rolled crypto from the fleet discarded)
- [x] Engine copy loop: HL every 10s + on leader fills (WebSocket), PM every 30s; ledger; kill switches incl. flatten; stop = flatten then end
- [x] Key custody: browser seals agent keys to the engine's RSA key (generated on the VPS); server verifies delegation on Hyperliquid before storing; engine re-verifies before use
- [x] Web: follow panel, Following (paper P&L, pause/resume/stop, panic), Activity ledger, Settings (connect/replace/remove key), go-live with step-up signature
- [x] E2E verified: paper copy on HL (fresh fill -> gates -> fill), PM cycle, signed-in web flow, key-refusal tests
- [x] Monitoring: K2 freshness monitor checks the engine process; watchdog cron restarts it
- [ ] Operator: set `LIVE_OWNER_ADDRESSES` in Vercel to the operator's wallet(s) to enable live trading
- [x] Risk-limit editor in Settings (account-wide; tightening instant, loosening needs a fresh wallet signature; slippage/signal age/book share stay per-venue defaults)
- [ ] (Deferred by owner) live Polymarket trading

## Operations

| What | Where | How |
|---|---|---|
| Website | Vercel project `slipstream` (k2man1) | `vercel deploy --prod --yes` from the repo root |
| Engine | VPS `~/slipstream-engine/` (Node 22 in `~/.local/node`) | `node apps/engine/build.mjs`, rsync `apps/engine/dist/engine.mjs*`, then `stop-engine.sh; run-engine.sh` on the VPS |
| Engine keepalive | VPS crontab | `run-engine.sh` every 5 min + `@reboot`; tracks the process by `engine.pid` |
| Engine secrets | VPS `~/slipstream-engine/.env` (600), `engine-key.pk8` (600) | the private key never leaves the VPS; the public half is `NEXT_PUBLIC_ENGINE_PUBLIC_KEY` in Vercel |
| Database | Supabase `slipstream-db` (us-east-1) | `DATABASE_URL=$POSTGRES_URL_NON_POOLING pnpm db:migrate`; every new table needs an RLS line (test enforces) |
| One-off jobs | VPS | `node engine.mjs --once intel:hl|intel:pm|copy:hl|copy:pm` (with `.env` sourced) |
| Logs | VPS `~/slipstream-engine/logs/` | rotated nightly by `~/dev/ops/logrotate.conf` |
