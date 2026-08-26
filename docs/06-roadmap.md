# 06 — Roadmap

Six phases. Each ends in something you can *watch working*, not a green test suite. Every exit criterion is a command or an observable demo, because "done" without a settling command degenerates into taste.

---

## Phase 0 — Skeleton and spikes

**Goal: prove the two riskiest unknowns before building anything on top of them.**

Two spikes come first, and everything else in this phase is scaffolding around them.

- **Spike A — Polymarket V2 order placement.** Place, then cancel, one real order on Polymarket via the deposit-wallet/POLY_1271 flow, from Node, using the V2 client. This is the largest technical risk in the plan; there are open SDK issues where L1 auth binds the API key to the EOA rather than the deposit wallet. *Output: it works, or it works with a documented workaround, or Polymarket writes move to Phase 4 and v1 ships PM read-only.*
- **Spike B — Hyperliquid delegation verification.** Confirm that, given a master address and a candidate agent address, we can prove the delegation on-chain from a third party's position ([04 §1](04-security-and-custody.md)). Then attempt the same for Polymarket and record honestly what is and isn't verifiable.

Scaffolding: monorepo, pnpm workspaces, TypeScript config, Vitest, lint, CI. `infra/docker-compose.yml` bringing up Postgres, Redis, web, and engine with one command. Drizzle schema and migrations. SIWE auth. `packages/shared/money` with its full test suite — money math is written once, early, and never again. **`packages/testkit`: the venue simulator**, deterministic, replaying recorded fill fixtures, plus a fixture recorder script pointed at mainnet.

**Exit:** `docker compose up` gives a working local stack; you sign in with your wallet and the dashboard shows your **real** Hyperliquid and Polymarket balances and positions, read-only. `pnpm test` green. Both spikes written up in `docs/spikes/`.

---

## Phase 1 — Manual trading

**Goal: place a real trade on both venues from the web app.**

Key entry with on-chain delegation verification and envelope encryption ([04](04-security-and-custody.md)). The executor, with idempotency keys and the per-user lock. The risk gate, with the caps that apply to manual orders. Order tickets for both venues. Positions, open orders, and fill history.

**Exit:** from the deployed app, open and close a real position on Hyperliquid and a real position on Polymarket, with real money, small size. The risk gate correctly blocks an order that would exceed a cap, and says why. Killing the engine mid-order leaves no duplicate on restart.

---

## Phase 2 — The tracker

**Goal: paste a whale's address, get an honest picture of them.**

Leader fill indexing (WS live + REST backfill), statistics computation, the trader profile page. Multiplexed subscriptions so one leader followed by fifty users costs one connection.

**Exit:** paste any Hyperliquid address and any Polymarket address; within seconds see equity curve, PnL windows, win rate, max drawdown, average hold, and recent trades — cross-checked by hand against the venue's own UI for at least three wallets per venue.

---

## Phase 3 — The copy engine

**Goal: mirrored positions, on testnet, with every gate working.**

The target-state planner, all four sizing modes, the full risk gate, exits-are-sacred, the reconciler, the decision ledger, paper mode, kill switches. Scenario suite in the simulator covering: missed events, duplicate events, reconnect snapshots, partial fills, leader-closes-during-our-entry, orphan positions, Polymarket resolution, and rate-limit exhaustion.

**Exit:** on Hyperliquid testnet, follow a wallet you control from a second wallet you control. Trade the leader; the follower mirrors within tolerance. Kill the engine mid-sequence and restart — it reconciles to correct state with no duplicates. Force each gate to fire and confirm the ledger explains it. Paper mode produces plausible fills against a live book.

---

## Phase 4 — Hardening and mainnet

**Goal: safe enough to point at real money that isn't yours.**

KMS-backed vault (AWS and GCP implementations plus local file). Log redaction with the allowlist redactor and its CI grep. Rate-limit budget accounting and the UI meter. Engine sharding leases. Dead-man's switch. Health checks and alarms ([01 §6](01-architecture.md)). Drift alarms. Incident policy committed. ToS and risk disclosure.

**Exit:** a **7-day continuous live run** on mainnet with real money and small caps, following at least two leaders per venue. Zero unexplained ledger entries, zero drift alarms unresolved, zero key material anywhere in logs (verified by grep over the full week's output). A deliberate mid-run engine restart and a deliberate mid-run venue-socket kill, both recovered without manual intervention.

---

## Phase 5 — Public launch

**Goal: other people can use it, and other people can run it.**

Landing page and the design pass. Docs: self-host guide, security model write-up, per-provider deploy recipes (Vercel, Railway, Fly, Render, bare Docker). Notifications (Telegram, Discord, email). CSV export. `slipstream.k2capitalmanagement.xyz` live. GitHub repo public with issue templates, contribution guide, and a security policy.

**Exit:** a person who is not you follows the self-host guide on a clean machine and reaches a working instance without asking a question. The hosted instance runs 30 days with no security incident and no unexplained divergence between intended and actual positions.

---

## Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Polymarket V2 POLY_1271 order placement is blocked by SDK bugs** | Medium | High — halves the product | Phase 0 Spike A settles it before anything is built on it. Fallback: v1 ships PM read-only + tracker, writes follow later |
| 2 | **Copy trading is simply unprofitable after slippage** | **High** | Medium — it's a real product either way | Confront it: gates, honest skip reporting, the "what would have happened" simulator. We sell a tool, never a return |
| 3 | Hyperliquid per-IP limit throttles a shared engine | Medium | Medium | WS-first reads, shared market data, sharding leases from day one, budget meter |
| 4 | Per-address limits strand small accounts | Medium | Medium | Surface the meter; planner prefers fewer, larger corrections; document the floor honestly in onboarding |
| 5 | **Key compromise via engine breach** | Low | **High but bounded** | The whole of [04](04-security-and-custody.md). Worst case is unwanted trades, never withdrawal — structurally |
| 6 | Venue API breaking change (another V2-scale cutover) | Medium | High | Adapter seam; startup assertion on EIP-712 domain versions; pinned SDK versions; integration tests against live testnet in CI |
| 7 | Regulatory attention to a hosted auto-trading service | Medium | High | Legal advice before onboarding strangers; no recommendations or rankings; self-host path always available as the fallback posture |
| 8 | A leader is manipulating followers (trading against copiers) | Medium | Medium | Surface suspicious patterns in trader stats; slippage gate incidentally defuses most of it; never rank or endorse |
| 9 | Agent fleet produces plausible-but-wrong money math | Medium | High | `packages/shared/money` written and reviewed by hand in Phase 0, then frozen; property-based tests; float lint ban |
| 10 | Scope creep into strategy features | High | Medium | [03 §10](03-copy-engine.md) is an explicit no-list. Additions require deleting something |
