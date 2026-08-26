# 03 — The Copy Engine

This is the part that matters. Everything else is plumbing around it.

## 1. What copy trading actually is, honestly

A leader opens a position. You want the same position, scaled to your account, entered close enough to their price that their edge survives the gap.

Three things make this hard, and none of them are solved by writing faster code:

1. **You are always late.** The leader's trade is itself part of why the price moved. On thin markets the move can exceed the entire edge — the canonical failure is a whale buying at 0.38 and the follower filling at 0.61, which is not a copy of the trade, it's the other side of it.
2. **Event streams lie by omission.** Sockets drop. Snapshots replay. A copy engine built on "apply each fill as a delta" desynchronizes permanently the first time it misses one, and it will miss one.
3. **The leader's risk is not your risk.** They may be running 20x on 5% of a $10M book. Copied naively at your size, that is a different trade with a different survival probability.

The engine's three core design decisions map one-to-one onto these.

## 2. Core decision: mirror position *state*, not trade *events*

**Rejected:** consume fill events, translate each into a proportional order. This is what most open-source copy bots do. It is simple, and it is wrong: correctness depends on receiving every event exactly once, forever.

**Chosen:** treat the leader's current position as a **target**, and continuously drive the follower toward a scaled version of it.

```
desired_follower_position = f(leader_position, sizing_mode, follower_equity, caps)
delta = desired_follower_position − actual_follower_position
if |delta| > tolerance: emit TradeIntent(delta)
```

Events are demoted from "the instruction" to "a hint that it's worth recomputing". The same recompute also runs on a timer. Properties that fall out for free:

- **Self-healing.** A missed event is corrected on the next tick, not carried forever.
- **Idempotent.** Running the planner twice produces one correction, then nothing.
- **Crash-safe.** Restart reads positions from both venues and reconciles. No replay log, no recovery mode — the venue is the source of truth, never our database.
- **Late-join works.** Following a leader who is already in a position is not a special case; it's just a large initial delta (subject to the entry gates below, which will often correctly refuse it).

The cost is that we need reliable position reads for both leader and follower, and a tolerance band to avoid thrashing on dust. Both are cheap. This is the single most important structural difference between Slipstream and the existing field.

**Tolerance band:** no correction is emitted unless the delta exceeds `max(min_notional, 2% of desired)`. Without it, funding payments and mark drift generate a permanent trickle of tiny rebalancing orders that burn the per-address rate limit and pay fees for nothing.

## 3. Sizing modes

`desired = leader_position × scale`, where `scale` depends on the mode:

| Mode | Scale | Use when |
|---|---|---|
| **`equity_ratio`** *(default)* | `(your_equity / leader_equity) × multiplier` | You want their *risk profile*, not their dollar size. Scale-free: a $2k account following a $10M whale gets a proportionate position. Auto-adjusts as either account grows |
| **`fixed_notional`** | such that position notional = `$X` | You want predictable, bounded exposure per trade regardless of what they do |
| **`percent_equity`** | such that notional = `X%` of your equity | Same as above, but scales with your account |
| **`fixed_multiplier`** | `k × leader_size` | You explicitly want their size × k. **Dangerous** — a whale's normal trade can exceed your whole account. Gated behind a confirmation and always clamped by caps |

Notes that matter:
- `leader_equity` comes from the venue (`clearinghouseState` / Data API portfolio value), refreshed on a slow timer. If it is unavailable, `equity_ratio` **fails closed** — no copy, logged as a skip. Guessing a leader's equity to size a leveraged position is not acceptable.
- Caps in [§4](#4-the-risk-gate) always apply *after* the mode. Modes propose; caps dispose.
- Cross-venue sizing uses the follower's equity **on that venue**, not their total. Polymarket collateral cannot back a Hyperliquid perp.

## 4. The risk gate

Every intent passes through, in this order. First failure short-circuits and writes a `SkipDecision` with a machine-readable `reason_code` and the actual numbers.

| Gate | Rejects when | Default |
|---|---|---|
| `kill_switch` | global, per-user, or per-subscription stop is set | — |
| `market_filter` | market is outside the subscription's allow/blocklist | allow all |
| `signal_age` | event is older than `max_signal_age_ms` | 5000 ms |
| `slippage` | current executable price is worse than leader's fill by > `max_slippage_bps` | 50 bps (HL) / 300 bps (PM) |
| `book_depth` | the order would consume > `max_book_pct` of visible depth inside the slippage band | 20% |
| `position_cap` | resulting notional > `max_notional_per_position` or > `max_position_pct_equity` | $1000 / 20% |
| `exposure_cap` | resulting total exposure > `max_total_exposure` | 50% of equity |
| `leverage_cap` | resulting account leverage > `max_leverage` | 3x |
| `daily_loss` | realized loss today > `daily_loss_limit` → stop opening for the day | 10% of equity |
| `rate_budget` | remaining venue address-budget below reserve | keep 20% in reserve |

Defaults are deliberately conservative. A user who wants to be reckless has to type the number themselves, which is both a safety property and an informed-consent property.

**The `slippage` gate is the honest answer to §1.1.** We do not chase. If the price has already run past the leader's entry, we decline and say so. This will feel wrong to users the first time — the onboarding explicitly sets the expectation that a well-configured Slipstream *skips a lot*, and that the skip is the product working.

## 5. Exits are unconditional

**Every gate above applies to opening and increasing only.**

If a leader closes or reduces, we close or reduce. No slippage gate, no exposure check, no market filter, no daily-loss stop. The kill switch does not block an exit either — a kill switch *causes* exits, it does not prevent them.

This is not a nuance, it is the difference between a risk system and a trap. A gate that can block an exit produces the specific catastrophe of a follower stuck in a leveraged position that its own leader has already abandoned. Exits route through a distinct `ExitIntent` type that structurally cannot carry a gate result, so this cannot be broken by someone adding a gate later without noticing.

Exit execution is also more aggressive by default: IOC/market rather than passive limit, because a partially-filled exit is a worse outcome than a slightly worse price.

**Corollary — orphan detection.** If we hold a copied position and the leader's position has vanished by a route we did not observe (missed event, manual close, Polymarket resolution), the reconciler flags it as an orphan and closes it. Resolution is distinguished from a close by checking market status, because a resolved market's position must be *settled*, not traded out of.

## 6. Failure modes and their handling

| Failure | Handling |
|---|---|
| WS drops | exponential backoff reconnect; on reconnect the snapshot is a state reset, not new fills; reconciler covers the gap |
| Duplicate fill event | `venue_fill_id UNIQUE` makes reprocessing a no-op |
| Order rejected (tick/lot) | quantize bug — alarm loudly, do not silently retry with a nudged size |
| Order rejected (insufficient margin) | recompute against live equity, retry once smaller, then skip with a clear reason |
| Rate limited | back off, surface remaining budget in UI, never spin |
| Partial fill | target-state design handles it natively: next tick sees a smaller delta |
| Leader closes while our entry is resting | exit path cancels the resting entry first, then reduces whatever filled |
| Leader is a wash trader / manipulating | out of scope for automation. Trader stats surface suspicious patterns (round-trip frequency, self-crossing, tiny-market concentration) so a human can judge |
| Our equity read is stale | sizing fails closed |
| Two engine instances claim one user | Redis lease + per-user execution lock; a lock holder that dies has its lease expire before another instance may act |

## 7. The decision ledger

Every planner and gate outcome writes one append-only row: what we saw, what we decided, why, and the numbers.

```
[14:02:11] HL · BTC · leader 0x7a3f… opened long 12.4 BTC @ 64,210
           → SKIPPED — slippage 87bps > your 50bps limit (best ask 64,769)
[14:02:11] HL · ETH · leader 0x7a3f… opened long 180 ETH @ 3,142
           → COPIED 0.61 ETH @ 3,144 (equity_ratio 0.0034×) — 6bps slippage
[14:47:03] PM · "Fed cuts in Sept" · leader closed 40,000 YES @ 0.71
           → EXITED 128 YES @ 0.706 (exit, ungated)
```

This is a **product feature**, not a debug log. It is the primary trust surface: it proves the bot is working when it appears to be doing nothing, and it makes a bad configuration visible ("you skipped 34 of 40 signals this week — your slippage limit may be too tight for this leader"). Competing tools show fills and hide skips, which is exactly backwards.

## 8. Manual trading shares this machinery

Manual orders enter as `order_intents` with `subscription_id = NULL` and traverse the **same** executor and the **same** risk gate, minus the copy-specific gates (`signal_age`, `slippage`-vs-leader, `market_filter`).

The exposure, leverage, and daily-loss caps **do** apply to manual orders. This is intentional and stated in the UI: your risk limits protect you from your own 2am clicking as much as from a leader's bad day. A user who wants to exceed a cap manually must raise the cap — a deliberate act, in a different screen, that is written to the audit log.

Manual surface per venue: Hyperliquid perps (market/limit, reduce-only, TP/SL, leverage, cross/isolated) and spot; Polymarket buy/sell of either outcome, market and limit, against a live book. Both share one order ticket component with venue-driven capabilities.

## 9. Paper mode

A first-class runtime, selectable per subscription. Identical planner, identical gates, identical ledger — only the executor is swapped for a simulated one that fills against the live book with a configurable latency penalty and a conservative fill model (crosses the spread, assumes you are last in queue at your price level).

Three jobs:
1. **Evaluate a leader with skin-free skin in the game** before committing capital.
2. **Regression-test the engine** — the scenario suite in `packages/testkit` is paper mode driven by recorded fixtures.
3. **Make onboarding safe** — new accounts default to paper for their first subscription, with an explicit switch to live.

The simulation is deliberately pessimistic. A paper mode that flatters the strategy is worse than none, because it manufactures confidence for a live run.

## 10. What we are explicitly not building

- **No leader ranking or recommendation.** We show statistics, including unflattering ones; we do not tell anyone who to follow. That is both an integrity position and a regulatory one.
- **No martingale, grid, or averaging-down automation.** Not because they can't be coded, but because they turn a bounded loss into an unbounded one under exactly the conditions where users stop watching.
- **No cross-venue hedging or arbitrage in v1.** The correlation modelling required to do it correctly is a project of its own.
- **No "copy with AI improvements".** If we can't explain a decision in one ledger line, it doesn't ship.
