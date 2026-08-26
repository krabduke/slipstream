# 01 — Architecture

## 1. Why there are three planes and not one

The instinct is "Next.js app on Vercel, done". That does not work here, and the reason is worth stating precisely because it drives every other structural decision.

A copy-trading bot's core loop is: hold a WebSocket open to a venue, forever, and react within a second. Vercel cannot do this:

| Constraint | Reality on Vercel (Aug 2026) | Consequence |
|---|---|---|
| Cron frequency | Hobby: **2 jobs, once per day.** Pro: per-minute | Polling for leader fills is impossible on Hobby and unacceptably coarse on Pro |
| Function max duration | 300s default; 800s Pro with Fluid; 1800s Pro beta | A socket dies every 5–30 minutes, mid-position |
| WebSocket support | Native since June 2026 beta, 5-minute default cap | Fine for browser→server UI streams, useless for server→venue feeds |
| Process identity | Functions are ephemeral and horizontally duplicated | No stable place to hold in-memory position state, dedupe, or nonces |

So the engine is a **long-lived process in a container**. Once you accept that, the architecture gets simpler, not harder, and provider portability comes free — the engine is a plain Node process with a `Dockerfile`, so Railway, Fly, Render, Hetzner, a Raspberry Pi, or your laptop all run it identically.

**The three planes:**

1. **Control plane** — `apps/web`, Next.js 15 App Router. Authentication, configuration, the UI, read-only market data for display, and *intent capture* (a manual order becomes a row, not an HTTP call to a venue). Deployed to Vercel by default. Stateless.
2. **Data plane** — `apps/engine`, a Node 22 process. Venue sockets, the copy engine, order placement, reconciliation, leader indexing. Deployed to any container host. Stateful in memory, recoverable from Postgres/Redis.
3. **Stores** — Postgres for durable truth, Redis for streams, locks, nonces and kill flags. Both behind narrow interfaces.

The planes communicate only through the stores. There is no RPC from web to engine. This is deliberate: it means the engine keeps trading correctly while the website is down, being redeployed, or rate-limited — which is exactly the property you want from something holding open leveraged positions.

## 2. Request paths, concretely

**A user places a manual order:**
```
Browser → POST /api/orders (Next.js route handler)
        → validate with zod, check risk limits synchronously (fast, DB-only)
        → INSERT order_intent (status=pending, idempotency_key)
        → XADD slipstream:intents  (Redis stream)
        → 202 Accepted + intent id
Engine  → XREADGROUP consumes intent
        → risk-gate re-check (authoritative, sees live positions)
        → decrypt key → sign → POST venue /exchange
        → UPDATE order_intent (status, venue_order_id, ledger entry)
Browser → SSE /api/stream subscribes to that user's ledger updates
```

The double risk check is intentional. The web check is for instant feedback ("this would exceed your cap"); the engine check is the one that is actually trusted, because only the engine sees live positions.

**A leader trades:**
```
Venue WS → leader-watcher (one connection per venue, all leaders multiplexed)
         → normalize → XADD slipstream:leader-events
         → copy-planner: for each follower subscribed to this leader,
           recompute target position, diff against actual
         → risk-gate → executor → ledger
```

**Nothing happened for 15 seconds:**
```
reconciler tick → recompute every active subscription's target vs actual
                → emit corrective intents for any drift beyond tolerance
```
This sweep is what makes a missed WebSocket message a non-event instead of a permanent desync. See [03 §2](03-copy-engine.md).

## 3. Engine internals

The engine is a set of cooperating loops in one process, not microservices. Each is a module in `apps/engine/src/` with a single responsibility and an explicit input/output contract:

| Module | Input | Output | Owns |
|---|---|---|---|
| `leader-watcher` | venue WS | `LeaderEvent` on Redis stream | connection lifecycle, resubscribe, dedupe, snapshot-vs-delta handling |
| `tracker` | `LeaderEvent` + REST backfill | rows in `leader_fills`, `leader_stats` | historical indexing, statistics computation |
| `copy-planner` | `LeaderEvent` \| reconciler tick | `TradeIntent[]` \| `SkipDecision[]` | target-state math, sizing modes |
| `risk-gate` | `TradeIntent` | `Approved` \| `SkipDecision` | caps, slippage, staleness, kill switches |
| `executor` | `Approved` | venue orders, `Fill` rows | idempotency, retries, nonce/rate management, key decryption |
| `reconciler` | timer | planner invocations | drift detection, orphan-position alarms |
| `ledger` | everything | append-only `decisions` rows | the trust surface |

**Sharding:** an engine instance claims a set of `user_id` ranges via a Redis lease. Adding capacity means starting another container; leases rebalance. A single instance comfortably handles the v1 target (see [06](06-roadmap.md)) and this only matters at scale, but the seam exists from day one because retrofitting it is painful.

**Crash behaviour:** on start, the engine reads open positions from both venues (source of truth is the venue, never our DB), reads active subscriptions from Postgres, and reconciles. There is no recovery log to replay. This is a direct consequence of decision #2 — target-state systems recover by looking at the world, not at their own history.

## 4. Storage

**Postgres** is durable truth for everything except live venue state. Drizzle ORM for typed queries and migrations — SQL-first, no hidden magic, and the generated migrations are readable in review, which matters when an agent fleet is writing them.

Core tables (full schema in [02 §6](02-venues-and-data.md)):
`users`, `venue_accounts`, `encrypted_keys`, `leaders`, `leader_fills`, `leader_stats`, `subscriptions`, `risk_profiles`, `order_intents`, `fills`, `positions_snapshot`, `decisions`, `audit_log`.

**Redis** holds only things that are allowed to be lost on a flush: consumer-group streams for intents and leader events, per-user execution locks, SIWE nonces, rate-limit token buckets, and kill-switch flags. The kill switch is deliberately in *both* Redis and Postgres — Redis so it is instant, Postgres so it survives a Redis wipe, and the engine treats "either says stop" as stop.

**Portability rule:** no Vercel KV, no Vercel Blob, no Vercel Postgres-specific SQL, no edge-runtime-only APIs. Every provider-specific thing lives behind an interface in `packages/shared/adapters/`. Switching hosts is a `.env` change plus a deploy recipe, and `infra/` ships recipes for Vercel, Railway, Fly, Render, and bare Docker Compose so this is proven rather than claimed.

## 5. Stack decisions

| Layer | Choice | Why, and what was rejected |
|---|---|---|
| Language | **TypeScript everywhere**, Node 22 | Both venues have first-class TS SDKs. Polymarket's own SDK is Python-first, which tempts a Python engine — rejected, because a two-language split doubles the type boundary exactly where money math lives |
| Web | **Next.js 15 App Router** | Server Components for the data-heavy dashboard, route handlers for the API, and it is the path of least resistance on Vercel while remaining `next start`-able anywhere |
| Hyperliquid SDK | **`@nktkas/hyperliquid`** | Best-maintained TS SDK, minimal deps, fully typed, runtime-agnostic. Community-maintained, not official — so the adapter wraps it and we own the types at our boundary |
| Polymarket SDK | **`@polymarket/clob-client-v2`**, evaluating the newer unified `Polymarket/ts-sdk` | V1 is dead as of the 28 Apr 2026 cutover. Pick during the Phase 0 spike; the adapter interface makes this reversible |
| Chain interaction | **viem** | `approveAgent`, SIWE verification, ERC-1271 owner checks, USDC balance reads |
| DB | **Postgres + Drizzle** | See above |
| Styling | **Tailwind + shadcn/ui as a starting point, not a destination** | Visual direction is decided in [05](05-frontend.md) and by a human; component primitives are not the design |
| Validation | **zod**, one schema per boundary | Same schemas shared by web and engine via `packages/shared` |
| Money | **hand-rolled fixed-point decimals**, never floats | See [02 §5](02-venues-and-data.md). `0.1 + 0.2` problems become rejected orders and wrong position sizes |
| Tests | **Vitest** + the venue simulator | See [06](06-roadmap.md) |

## 6. Observability

Because this trades real money unattended, the minimum bar is higher than a normal web app:

- **Structured logs with an allowlist redactor.** Fields are opted *in* to being logged. A denylist eventually leaks a key through a field somebody forgot; an allowlist fails closed.
- **The decision ledger doubles as the audit trail.** Every skip, every fill, every gate rejection, with the numeric reason.
- **Health checks that mean something:** WS connection age per venue, seconds since last leader event, reconciler drift magnitude, oldest unconsumed stream entry, per-user remaining rate-limit budget. A green tick that only proves the process is alive is worse than no health check.
- **Alarms** on: drift beyond tolerance for >60s, a venue socket down >30s, any executor error class that is not a known-benign rejection, and any decryption failure.

## 7. The fee hook that ships turned off

Hyperliquid builder codes let a frontend attach a code to orders and earn a share, capped at 0.10% for perps and 1.00% for spot, and requiring an explicit one-time user approval signed by their main wallet.

Slipstream implements the hook — `builderCode` is a config value threaded through the executor — and ships it **empty and disabled**. Reasons: the promise is zero fees; a builder code requires an extra signature during onboarding which is friction we do not want to justify; and a self-hoster running their own instance may legitimately want to set their own. The code path being present means enabling it later is configuration, not surgery. Polymarket has no equivalent mechanism, so the question does not arise there.
