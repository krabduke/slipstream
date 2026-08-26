# 05 — Frontend

## 1. What this document is and isn't

This is the **information architecture and interaction spec**: what screens exist, what each one is for, what state it can be in, and what the user is meant to feel while looking at it. It deliberately stops short of prescribing the visual language, which gets a dedicated design pass by a human (see [08](08-build-fleet.md) — frontend design is never delegated to a bulk worker).

## 2. The design problem, stated

Three constraints pull against each other:

1. **This app can lose people money while they sleep.** Every destructive or exposure-increasing action needs friction proportional to its consequence — and the app must be legible at a glance to someone checking their phone at a traffic light.
2. **The most important thing it does is often nothing.** A well-configured Slipstream skips a lot ([03 §4](03-copy-engine.md)). A UI that only celebrates fills makes correct behaviour look like a broken app. **The activity feed, showing skips with reasons, is the emotional centre of the product** — not the PnL number.
3. **Two venues with incompatible mental models** — leveraged perps and binary prediction shares — have to coexist without the UI becoming a lowest-common-denominator table of nothing.

The resolution: **one shared shell and one shared risk vocabulary, with venue-specific panels where the instruments genuinely differ.** Positions, exposure, activity and follows are unified surfaces. The order ticket and the market view are venue-native.

Aesthetic direction is decided at build time, but three constraints are fixed now because they are functional, not decorative:
- **Numbers are the interface.** Tabular figures, consistent decimal alignment, no number that changes width as it ticks. Financial data that jitters is data people stop trusting.
- **Colour carries meaning and nothing else.** Green/red mean direction and PnL sign — so they cannot also be brand accents, decoration, or hover states. Never colour alone: pair with sign and label for accessibility.
- **Dark and light both first-class**, both explicitly designed. Traders use both; a bolted-on second theme is immediately obvious.

## 3. Screens

### Landing (public)
The pitch is the security model, because it is the only claim here nobody else can make. Above the fold: *"A copy-trading bot that cannot steal your money — and the code to prove it."* Then the honest part, which is also a differentiator: an explanation of why copy trading is usually a losing game and what Slipstream refuses to do about it. Links: GitHub, docs, one-click self-host.

### Onboarding wizard
The highest-stakes flow in the app; each step must be individually understood, not clicked through.

1. **Connect wallet** — SIWE. Explain that this signature costs nothing and moves nothing.
2. **Choose venue(s)** — Hyperliquid, Polymarket, or both.
3. **Grant trading access** — generate agent key in-browser, sign `approveAgent`. This screen must *show* the security property, not assert it: a plain diagram of what the key can and cannot do. Polymarket gets its additional consent screen ([04 §1](04-security-and-custody.md)).
4. **Set risk limits** — conservative defaults pre-filled, each with a plain-language consequence sentence ("at 3x, a 33% move against you liquidates"). Raising a limit requires interacting with it, not accepting it.
5. **Paper or live** — paper is the default and is presented as the smart choice, not the training-wheels choice.

### Dashboard
One screen answering "am I okay?": total equity and today's change across both venues, open positions, active follows with per-follow PnL, exposure against caps as a filled meter, and the last few activity lines. The Hyperliquid **remaining-actions meter** lives here too ([02 §2](02-venues-and-data.md)) — an obscure rate limit becomes an intelligible gauge instead of a mystery failure.

Panic button is always present, never hidden in a menu, and confirms with an explicit choice between *stop opening* and *flatten everything*.

### Traders
Add a wallet by pasting its address — the primary action, since there is no curated list by design. Shows wallets you track and wallets other users track (aggregate counts only, never identities).

**Trader profile** is where the discovery moat gets built. Equity curve, PnL by window, win rate, **max drawdown**, average hold time, position-size distribution, market concentration, and recent trades. Presented neutrally and slightly pessimistically: max drawdown and losing streaks get the same visual weight as returns, because the failure mode of every copy-trading UI is making a lucky wallet look like a genius. A **"what would have happened"** panel simulates following this wallet under *your* current settings over the last N days, including the skips — turning configuration from guesswork into evidence.

### Follows
List of subscriptions, each with sizing mode, caps, status, live/paper, and a kill switch. The edit view is the app's most dangerous form: every field states its consequence, and the diff of what you changed is shown before saving. Changes are audit-logged.

### Trade (manual)
Venue-native. Hyperliquid: order ticket with market/limit, size in asset or notional, leverage, cross/isolated, reduce-only, TP/SL, against a live book and chart. Polymarket: market search, outcome selection, YES/NO pricing with implied probability shown as the primary number, book depth, and an explicit reminder of resolution date and criteria — the single most common way people lose money on prediction markets is misunderstanding what resolves the market.

Both tickets show the risk-gate verdict **before** submission: "this order would put you at 2.8x of your 3x cap."

### Activity
The trust surface. A chronological, filterable ledger of every decision — copies, exits, skips, rejections, manual orders, limit changes — each with the numbers that produced it. Filter by verdict, leader, venue, market. Export to CSV.

Skips are shown with **equal prominence** to fills. When skips cluster, the app says so plainly: *"You skipped 34 of 40 signals from this leader this week. Your 50bps slippage limit may be too tight for how they trade."* That sentence is the difference between a tool people abandon and a tool people tune.

### Settings
Keys (add, rotate, revoke — with the on-chain effect explained), default risk profile, notifications (Telegram, Discord, email), theme, and a danger zone: revoke all keys, delete account, export data.

## 4. Real-time behaviour

Server-Sent Events from `apps/web` to the browser, fed by Postgres `LISTEN/NOTIFY` on ledger inserts. SSE over WebSockets because the traffic is one-directional and SSE reconnects itself; the earlier point about Vercel's 5-minute socket cap applies here too, so the client must treat reconnection as normal rather than exceptional and backfill the gap by timestamp.

Stale data must **look** stale: if the connection drops or the engine's last heartbeat is old, numbers visibly de-emphasise and a banner states when data was last confirmed. A dashboard confidently displaying a five-minute-old position is worse than one admitting it doesn't know.

## 5. States that must be designed, not improvised

Every one of these is a real state this app enters, and each is a place where a vague UI causes a real loss:

- **Empty** — no keys, no follows, no positions.
- **Paper** — visually distinct from live at all times, unmistakably, on every screen. Confusing paper for live is a catastrophic failure of UI.
- **Engine down** — the website is up, the bot is not. Must be stated loudly and immediately; this is the state most likely to be misread as "nothing is happening".
- **Venue degraded** — one venue's socket is down, the other is fine. Per-venue status, never a single global "ok".
- **Rate limited** — actions exhausted, with the recovery time.
- **Killed** — user or operator halted; what is still running (exits) must be explicit.
- **Liquidation risk** — a position approaching maintenance margin, escalating in prominence.
- **Market resolved** (Polymarket) — a position settled rather than traded out; distinct from a close, and explained.
