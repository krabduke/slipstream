# W1 — Fixed-point decimal money

Before writing any code, work through the Known traps below and state your plan. Then implement.

## Decision (already made — implement, do not revisit)

Implement `MoneyOps` exactly as declared in `packages/shared/src/money/types.ts`. That file is fixed; do not modify it. Replace the throwing stub in `packages/shared/src/money/ops.ts` with a real implementation. The exported `const money: MoneyOps` must stay, so the compiler proves the surface is complete.

Representation is already decided: `{ mantissa: bigint, scale: number }` meaning `mantissa * 10^-scale`, with `scale >= 0` always. All arithmetic is bigint arithmetic. There is no float anywhere in this package, including in tests.

`mul` and `div` take an explicit result `scale` and `Rounding` because there is no correct default — the caller knows what precision the venue wants. Do not invent one.

`quantizeToStep(a, step, rounding)` rounds `a` to a multiple of `step`. This is the primitive both venues' tick/lot quantization is built on, so it must be exact: no intermediate float, no division-then-multiplication that loses a unit in the last place.

`diffBps(reference, actual)` returns `(actual - reference) / reference * 10000` as a `number`, signed, rounded toward zero. It returns a `number` because it feeds a comparison against an integer bps limit, not because precision stops mattering — compute it in bigint and convert at the end.

## Files you own

```
packages/shared/src/money/ops.ts
packages/shared/src/money/__tests__/**
```

## Out of scope — do not edit

```
packages/shared/src/money/types.ts     Opus — the contract you implement
packages/shared/src/money/index.ts     Opus — the barrel
packages/shared/src/{brand,secret,notimpl}.ts   Opus
packages/shared/src/contracts/**       Opus
packages/shared/src/__tests__/**       Opus — Wave 0 invariant tests
packages/db/**                         W2
packages/venues/**                     W6/W7
```

## Read first

- `packages/shared/src/money/types.ts` — every doc comment there is a requirement
- `docs/02-venues-and-data.md` §5 — money math rules

Attach both in full.

## Definition of done

```bash
pnpm typecheck    # exit 0
pnpm test         # exit 0, and your tests must appear in the run
```

Plus: property-based tests (`fast-check` is already installed at the root — just import it) covering at minimum —
- `parse(format(d)) === d` round-trips for arbitrary mantissa/scale
- `add`/`sub` are inverse; `add` is commutative and associative
- `rescale` to a smaller scale then back never increases magnitude under `trunc`
- `quantizeToStep(a, step, "trunc")` is always `<= a` for positive `a`, and is always an exact multiple of `step`
- `cmp` is a total order consistent with `sub` sign

## Known traps

- **Never `number` for a money value, never `parseFloat`, never `Number()` on a venue string.** `parse` works on the string directly. A single float round-trip silently destroys precision and no test that only checks small values will catch it.
- **`scale` is part of the value.** `format` must not strip trailing zeros — `1.50` at scale 2 and `1.5` at scale 1 are different values and must round-trip distinctly through `parse`. `display` is the one that may prettify, and it is never sent to a venue.
- **Rounding direction is the caller's choice and must be honoured exactly.** `trunc` is toward zero, which for negative numbers is NOT the same as `floor`. Get this wrong and a short position sizes larger than intended.
- **Negative zero does not exist here.** Normalise `-0n` to `0n`.
- **`div` by zero throws.** It does not return zero, NaN, or Infinity. Silent fallbacks in money math are how wrong positions get opened.
- **Scale must never go negative.** `parse("1e6")` is scale 0 mantissa 1000000, not scale -6.
- Do not add convenience methods that are not in `MoneyOps`. The interface is the whole surface.
