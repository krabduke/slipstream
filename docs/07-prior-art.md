# 07 — Prior Art

Research pass, August 2026. The short version: **the field is thin and mostly low quality, which is the opportunity.**

## 1. Hyperliquid copy bots

A `hyperliquid-bot` GitHub topic with a handful of serious entries and a lot of noise.

| Project | Language | Notes |
|---|---|---|
| `MaxIsOntoSomething/Hyperliquid_Copy_Trader` | Python | MIT, clean, real-time monitoring and position sizing. Probably the most honest of the bunch |
| `cryptole0/Hyperliquid-Copy-Trading-Bot` | TypeScript | Claims production-grade; mirrors fills, configurable risk, dry-run and testnet modes |
| `jestersimpps/hyperliquid-copytrader` | TypeScript | Real-time dashboard, multi-account |
| `zkOSAI/hyperliquid-copy-trading-bot` | Node | Self-describes as "mostly copied from hypercopy.xyz" |
| `Brobicho/HLCopy` | Python | Monitors vault addresses, replicates positions |
| `gamma-trade-lab/...` | — | Keyword-stuffed SEO repo; description is the same phrase repeated ~14 times |

**Patterns across all of them:**
- Single-user CLI scripts driven by a `.env` containing a private key. **None** implement the un-withdrawable-key model, despite Hyperliquid providing agent wallets for exactly this purpose. This is the gap.
- **Event replay, not target-state reconciliation.** Miss a fill, desync forever.
- Risk controls are usually a size multiplier and a leverage cap. No slippage gate, no staleness gate, no book-depth check, no exposure cap, no daily loss limit.
- No skip reporting. You see fills; you never learn what was declined or why.
- Effectively none handle exits differently from entries.

## 2. Polymarket copy bots

| Project | Notes |
|---|---|
| `SnipeRun/polymarket-copy-trading-bot` | Supabase + Python, "7-layer exit engine", an AI co-pilot, "setup in 2 minutes" |
| `MrFadiAi/Polymarket-bot` | Node ≥18, four strategies, smart-money filter (60%+ win rate, 1.5 profit factor) |
| `Benjam1nCup/Polymarket-trading-bot-python-V2` | Copies top traders; another keyword-stuffed listing |
| `jhcdx9999/polymarket-copy-trade` | Copies smart wallets |
| `unitmargaretaustin/Polymarket-copy-trading-bot` | Wallet tracking with liquidity/spread/slippage filters — the only one in this set that visibly filters on liquidity |

**The V1/V2 landmine:** CLOB V2 went live 28 April 2026 and V1 signing stopped working. Any of these last updated before May 2026 is broken at the signing layer regardless of how good it looks. Worth checking commit dates before drawing inspiration from code.

## 3. What the honest analyses say

The most useful research finding is negative, and it comes from writeups *about* copy trading rather than repos implementing it: naive Polymarket copy trading loses money to slippage and can be actively exploited, because the alpha lives in the timing and the follower is definitionally late. The canonical example is a leader entering at 0.38 and the copy filling at 0.61.

We do not treat this as an obstacle to route around. It is the central design constraint, and it produced decision #4 (gate entries, never gate exits) and the skip-visibility principle in [03](03-copy-engine.md) and [05](05-frontend.md).

## 4. Adjacent products worth learning from

- **hypercopy.xyz** — hosted Hyperliquid copy trading; the closest commercial analogue and evidently the thing several repos were copied from.
- **PVP.trade, Phantom, Based** — builder-code integrations demonstrating that third-party Hyperliquid frontends are a real, large business (>$40M in builder revenue since launch; ~40% of Hyperliquid daily active users now trade through third-party frontends).
- **Nansen, HyperTracker, Predexon** — paid leaderboard and analytics APIs. We deliberately avoid depending on these so self-hosters need no paid key, and build our own index instead ([02](02-venues-and-data.md)).
- **Centralised-exchange copy trading (Bybit, BloFin, B2COPY/MT4 copiers)** — mature sizing vocabulary worth borrowing directly: fixed amount, fixed ratio, proportional-to-equity, proportional-to-balance × ratio. Our sizing modes are deliberately named to be recognisable to anyone who has used these.

## 5. What Slipstream does that none of the above do

1. **Refuses withdrawal-capable keys**, and verifies delegation on-chain before storing anything.
2. **Target-state reconciliation** instead of event replay — self-healing and crash-safe.
3. **Both venues in one risk engine**, with capability-driven rather than venue-conditional logic.
4. **Skips are first-class and visible**, with the numbers that caused them.
5. **Entries gated, exits never** — enforced by the type system, not by convention.
6. **Manual and copy trading share one executor and one risk gate.**
7. **Hosted *and* genuinely self-hostable**, with no paid API dependency and no proprietary storage.

## 6. Sources

Hyperliquid: [API docs — websocket](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket) · [subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions) · [nonces and API wallets](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets) · [rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits) · [builder codes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes) · [@nktkas/hyperliquid](https://github.com/nktkas/hyperliquid) · [agent wallets guide](https://nktkas.gitbook.io/hyperliquid/guides/agent-wallets-and-vaults) · [Chainstack API guide](https://chainstack.com/hyperliquid-api-guide-endpoints-sdk-websocket/) · [builder codes explained](https://hyperdash.com/learn/hyperliquid-builder-codes-explained-how-third-party-apps-earn-fees-on-chain)

Polymarket: [V2 migration guide](https://docs.polymarket.com/v2-migration) · [deposit wallets](https://docs.polymarket.com/trading/deposit-wallets) · [clients & SDKs](https://docs.polymarket.com/api-reference/clients-sdks) · [clob-client-v2 (TS)](https://github.com/Polymarket/clob-client-v2) · [py-clob-client-v2](https://github.com/Polymarket/py-clob-client-v2) · [POLY_1271 auth issue #70](https://github.com/Polymarket/py-clob-client-v2/issues/70) · [issue #77](https://github.com/Polymarket/py-clob-client-v2/issues/77) · [ctf-exchange signatures](https://github.com/Polymarket/ctf-exchange/blob/main/src/exchange/mixins/Signatures.sol) · [Chainstack Polymarket API](https://chainstack.com/polymarket-api-for-developers/)

Copy-trading mechanics: [why Polymarket copy trading doesn't work](https://startpolymarket.com/strategies/copy-trading/) · [B2COPY allocation methods](https://docs.b2copy.b2broker.com/copy-trading-pamm-and-mam-concepts/allocation-methods-for-copy-trading-and-mam) · [BloFin copy modes](https://blofin.com/en/support/articles/12361244393231-Copy-Trading-Modes-Smart-Copy-Fixed-Amount-and-Fixed-Ratio) · [slippage and latency in copy trading](https://copygram.app/blog/education/understanding-slippage-latency-copy-trading)

Platform: [Vercel limits](https://vercel.com/docs/limits) · [function duration](https://vercel.com/docs/functions/configuring-functions/duration) · [30-minute functions](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes) · [cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) · [WebSockets on Vercel](https://ably.com/vercel/websockets-on-vercel)

Security: [GCP envelope encryption](https://docs.cloud.google.com/kms/docs/envelope-encryption) · [key management best practices](https://dev.ubiqsecurity.com/docs/key-mgmt-best-practices) · [EIP-4361 SIWE](https://eips.ethereum.org/EIPS/eip-4361) · [SIWE docs](https://docs.siwe.xyz/)
