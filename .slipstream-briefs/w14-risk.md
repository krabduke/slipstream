# W14 — The risk gate

## Decision (already made — implement, do not revisit)

Implement `packages/risk`: the gates declared in `packages/risk/src/types.ts` (fixed), in this evaluation order, short-circuiting on first failure:

`kill_switch → market_filter → signal_age → slippage → book_depth → position_cap → exposure_cap → leverage_cap → daily_loss → rate_budget`

Each gate is a **pure function** of `(TradeIntent, RiskContext)`. No I/O, no clock reads, no venue calls — `ctx.now` is supplied. That is what makes them testable, and it is not negotiable.

`DEFAULT_LIMITS` (docs/03 §4): 50 bps slippage on Hyperliquid / 300 bps on Polymarket, 5000 ms max signal age, 20% max book consumption, $1000 max notional per position, 20% max position as share of equity, 50% max total exposure, 3x max leverage, 10% daily loss limit, 20% rate-budget reserve.

Every rejection returns a `ReasonCode` from the closed set plus a `detail` map of **pre-formatted strings** carrying the actual numbers — e.g. `{ observedBps: "87", limitBps: "50", bestAsk: "64769.0" }`. These strings are rendered directly to users, so they must be the real values, not rounded-for-display approximations.

## Files you own
```
packages/risk/src/{gates,defaults}.ts
packages/risk/src/gates/**
packages/risk/src/__tests__/**
```

## Out of scope — do not edit
```
packages/risk/src/types.ts     Opus — fixed
packages/risk/src/index.ts     Opus — barrel
packages/copy/**               W15
packages/exec/**               W13
```

## Read first
`packages/risk/src/types.ts`, `packages/shared/src/contracts/intents.ts`, **`docs/03-copy-engine.md` §4 and §5 in full**.

## Definition of done
```bash
pnpm typecheck && pnpm test
```
Plus:
- **One test per gate that fires it**, asserting the exact `ReasonCode` and that `detail` contains the real numbers.
- **A test proving no gate can reject an `ExitIntent`.** This is the single most important test in the package. It is a type-level test: `// @ts-expect-error` on passing an `ExitIntent` to `evaluate`. If that directive ever becomes "unused", someone has widened the signature and exits can now be blocked.

## Known traps
- **Entries are gated, exits never are.** A gate that can block an exit traps a follower in a leveraged position their leader has already left. Do not add an overload, a union parameter, or a "just this once" branch accepting an `ExitIntent`.
- **Gates must be pure.** No `Date.now()` — use `ctx.now`. An impure gate is untestable and behaves differently under load.
- **`slippage` compares against the leader's own fill price**, not against the last trade or the mid. The point is "how much worse than what they got".
- **`book_depth` measures depth inside the slippage band**, not total book depth. A deep book beyond your price limit is not liquidity you can use.
- **Fail closed.** Missing follower equity, missing leader equity, or an unavailable book is a rejection with a clear reason, never an assumed-safe pass.
- Defaults are conservative on purpose. Do not "improve" them.
