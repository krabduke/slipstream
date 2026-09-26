# Build log and plan (solo build, from 2026-09-26)

The agent fleet described in `08-build-fleet.md` is retired. `fleet/` is kept
for history only and must not be run: it dispatches work to OpenCode on
DashScope, which the owner has ruled out. Everything below is built directly.

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

- [x] Move out of `k2capital/`, repair worktrees (535 tests green)
- [x] Vercel project + Supabase database, migrations applied, REST path closed
- [x] `packages/intel`: metrics (time-weighted drawdown, round trips, consistency) + score
- [x] Hyperliquid profiler (leaderboard -> candidates -> deep profile)
- [ ] Polymarket profiler
- [ ] Intel job: refresh -> `trader_profiles`, `intel_runs`
- [ ] `apps/engine` skeleton on the VPS: scheduler, health, watchdog cron
- [ ] Web: Traders (discover, filters), trader profile, landing
- [ ] Auth: SIWE sessions
- [ ] Hyperliquid agent key onboarding (browser-generated, approveAgent, sealed to engine)
- [ ] Engine: leader watcher (HL WS, PM polling), planner, risk gate, paper executor, ledger
- [ ] Engine: live Hyperliquid executor, reconciler, kill switches, dead-man switch
- [ ] Web: dashboard, follows, activity ledger, settings, onboarding wizard
- [ ] Deploy web to Vercel + subdomain; engine on VPS; monitoring
- [ ] (Deferred by owner) live Polymarket trading
