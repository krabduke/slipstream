# 08 — The Build Fleet

How Slipstream gets built: ~20 delegated workers on Ox Alpha, in four waves, with Opus holding the design and the review gate. Modelled on the legios build structure (`.legios-briefs/` → `.slipstream-briefs/`), adapted for a project where a bug costs money rather than a re-run.

## 1. The worker model

**Primary: `dashscope/qwen3.8-max`** — the Alibaba Token Plan subscription. Proven under load: two prior measured runs absorbed 1.2M input and 15M cache reads with zero 429s. Verified working here on 2026-08-26 with 7 concurrent workers.

**~~Ox Alpha (`opencode/x-preview-f-free`)~~ — WITHDRAWN 2026-08-26.** It was the original plan: 1M context, multimodal, zero data retention, free. OpenCode removed it from the Zen roster exactly one week after announcing the free preview. Every worker then failed in under a second with `Model not found`, behind a generic `UnknownError` first line that reads like a transient outage. Independently confirmed by the parallel legios-research fleet, which measured a 3% error rate over 73,774 streams before it vanished.

**Free alternatives, measured on this machine by the legios-research session (2026-08-26):** `muse-spark-1.2-contributor-free` (1M context, 131k out, 176 streams / 0 errors) is the strongest; `nemotron-3-ultra-free` is free but effectively unusable, at 130 stream errors in 343 (37%, provider-side 502/504). Treat any replacement's error rate as unproven until a few thousand streams.

**Fallback: `opencode/muse-spark-1.2-contributor-free`** — free, 1M context, best-measured of the remaining Zen models.

**Why the fallback is written into the plan and not left implicit:** this already happened. Ox Alpha was withdrawn mid-build, six days after launch. Every brief in `.slipstream-briefs/` is model-agnostic prose, and the model is a single flag on the invocation, so a fleet mid-wave migrates by changing `-m`. No brief may contain model-specific instructions.

**Invocation:**
```bash
opencode run \
  -m opencode/x-preview-f-free \
  --dir ~/Projects/k2capital/slipstream \
  --title "w7-polymarket-read" \
  --thinking \
  --format json \
  "$(cat .slipstream-briefs/w7-polymarket-read.md)"

# corrective follow-up on the same worker — context is already there, so the brief is two sentences
opencode run -m opencode/x-preview-f-free -s <session-id> "Fix: quantize rounds sell limits down; spec says away from aggression. See docs/02 §5."
```

**On maximum reasoning effort — measured, not assumed.** `opencode run` exposes `--variant` for provider-specific reasoning effort. **It is a no-op on Ox Alpha.** Probed directly on 2026-08-26: `--variant high`, `--variant max`, and a deliberately invalid `--variant zzznotreal` all returned exit 0 with correct output and no error. An unvalidated flag is an ignored flag, so there is no effort dial to turn here and briefs must not pretend otherwise.

The levers that do exist:

1. **Brief precision, which is the largest measured lever anyway** — bigger than session reuse, bigger than any model setting. A brief naming exact files and stating the decision produced flawless output; an open-ended one produced two factual regressions at 25% higher input cost. Effort spent sharpening a brief beats any flag.
2. **`--thinking`** surfaces reasoning blocks. This buys *visibility for review*, not depth — but on the high-blast-radius territories in §7 it is worth capturing, because a worker's stated reasoning is where a wrong assumption becomes visible before the diff does.
3. **An explicit deliberation instruction in the brief preamble.** Reasoning models measurably respond to being told to work the problem before writing. Every brief for a §7 adversarial-review territory opens with: *"Before writing any code, work through the failure modes in the Known traps section and state your plan. Then implement."*
4. **1M-token context is the real luxury** — attach the full doc set rather than excerpts. `-f docs/02-venues-and-data.md -f docs/03-copy-engine.md` costs nothing on an unmetered model and removes an entire class of "the worker didn't know" defect. Do not economise on the worker's tokens; that trades away the thing the offload is buying.

**Housekeeping:** `~/.claude/skills/opencode/` does not currently exist on this machine, though the global CLAUDE.md points builds at it. Until it is restored, fleet invocation is the raw CLI above.

## 2. The split, and why each piece sits where it does

| Stays on Opus | Goes to Ox Alpha |
|---|---|
| Every cross-package **interface and type** (Wave 0) | Implementations behind those interfaces |
| All architecture and design decisions | Mechanical construction from a settled decision |
| **The entire frontend** — see §3 | Data-fetching hooks, API route handlers, adapters |
| `packages/shared/money` **review** (risk #9) | `money`'s first draft + property tests |
| Adversarial review of vault / exec / risk / copy | Everything's first draft |
| Anything touching credentials or key handling | Everything else |

Two rules from the standing workflow that this project makes non-negotiable:

- **The worker implements a decision; it never makes one.** Measured on real runs, a precise brief ("change X to Y at these paths") produced flawless output while an open-ended one ("find what's wrong") produced two factual regressions at 25% higher input cost. Discovery work is where cold workers invent plausible falsehoods. Every brief here names files and states the decision.
- **Never trust the worker's report.** `opencode` exits 0 with no final message routinely. Review the diff and run the command; the report is not evidence.

## 3. The frontend is not delegated

`apps/web/src/components/**` and every screen under `apps/web/src/app/(app)/**` are built by Opus, using the `frontend-design` skill, against [docs/05](05-frontend.md).

This holds even where the work looks mechanical. A settings panel, a form, "just wire up these fields" — the grouping, wording, validation feedback, empty and error states, and disabled-state logic are all judgment, and a worker optimising for "the fields are present" produces something that satisfies the brief and is bad to use. In an app where confusing paper mode for live loses real money, that is not an acceptable trade.

Workers may touch `apps/web/src/lib/**` (data access, hooks, SSE client) and `apps/web/src/app/api/**` (route handlers), which have no visual output.

## 4. Wave 0 — Opus writes the contracts first

Before any worker starts, Opus writes the files everything else depends on. This is what makes twenty parallel agents possible without design collisions: the seams are fixed, so workers fill volumes rather than negotiate boundaries.

- `packages/venues/src/types.ts` — `VenueAdapter`, `Market`, `Position`, `OrderRequest`, `MarketConstraints`
- `packages/shared/src/contracts/*.ts` — every zod schema crossing a boundary
- `packages/shared/src/money/types.ts` — the `Decimal` API surface (implementation is delegated)
- `packages/vault/src/types.ts` — `KeyVault`
- `packages/risk/src/types.ts` — gate types, and the closed set of `reason_code` values
- `packages/copy/src/types.ts` — `TradeIntent`, `ExitIntent`, `SkipDecision`
- `packages/db/src/schema.ts` — the Drizzle schema
- Repo scaffolding: workspaces, tsconfig, lint (including the float-in-money ban), Vitest config

`ExitIntent` being a distinct type from `TradeIntent` is a Wave 0 decision with teeth: it is what makes [03 §5](03-copy-engine.md) — exits are never gated — a compile error to violate rather than a convention to remember.

## 5. The four waves

Twenty workers, five at a time, each with a disjoint territory. Waves are barriers: wave N+1 starts when wave N is reviewed and merged, because later waves build on earlier interfaces being real.

### Wave 1 — Foundations
| # | Worker | Territory | Done when |
|---|---|---|---|
| W1 | money | `packages/shared/src/money/**` | `pnpm test money` green incl. property tests; no `number` in the package |
| W2 | db | `packages/db/**` | migrations apply to empty Postgres; typed queries compile; every query takes explicit `userId` |
| W3 | logger + env | `packages/shared/src/{log,env}/**` | allowlist redactor test proves a key-shaped field is dropped; env parse fails loudly on missing vars |
| W4 | infra | `infra/**`, `.github/workflows/**` | `docker compose up` yields healthy Postgres, Redis, web, engine; CI runs lint+typecheck+test |
| W5 | testkit | `packages/testkit/**` | simulator replays a recorded fixture deterministically twice with identical output |

### Wave 2 — Venues (read) and security
| # | Worker | Territory | Done when |
|---|---|---|---|
| W6 | HL read | `packages/venues/src/hyperliquid/{read,quantize}.ts` | fetches real positions/markets for a known address; quantize round-trips venue constraints |
| W7 | PM read | `packages/venues/src/polymarket/{read,quantize}.ts` | same, against Gamma + CLOB + Data API |
| W8 | vault | `packages/vault/**` | encrypt→decrypt round-trips on all three backends; wrong `aad` fails to decrypt |
| W9 | tracker | `packages/tracker/**` | stats for three known wallets per venue match the venue UI by hand |
| W10 | auth | `apps/web/src/lib/auth/**`, `app/api/auth/**` | SIWE sign-in issues a session; replayed nonce rejected; expired nonce rejected |

### Wave 3 — The engine
| # | Worker | Territory | Done when |
|---|---|---|---|
| W11 | HL write | `packages/venues/src/hyperliquid/write.ts` | places + cancels a real testnet order |
| W12 | PM write | `packages/venues/src/polymarket/write.ts` | places + cancels a real order; asserts EIP-712 Exchange domain v2 at startup |
| W13 | exec | `packages/exec/**` | duplicate idempotency key never double-places; crash between decide and place leaves no duplicate |
| W14 | risk | `packages/risk/**` | every gate has a test that fires it; **a test proves no gate can reject an `ExitIntent`** |
| W15 | copy | `packages/copy/**` | all four sizing modes tested; missed-event scenario self-heals within one reconciler tick |

### Wave 4 — Wiring and surfaces
| # | Worker | Territory | Done when |
|---|---|---|---|
| W16 | engine | `apps/engine/**` | full scenario suite passes; kill and restart mid-sequence reconciles clean |
| W17 | web API | `apps/web/src/app/api/**` (non-auth) | every route zod-validated and tenant-scoped; unscoped query is a type error |
| W18 | web data | `apps/web/src/lib/**` | SSE reconnects and backfills by timestamp after a forced drop |
| W19 | notifications | `packages/notify/**` | Telegram, Discord and email adapters deliver from one interface; failure never blocks a trade |
| W20 | docs | `docs/self-host.md`, `infra/recipes/**`, `README.md` | a clean machine reaches a running instance following only the guide |

*(Running alongside wave 4, on Opus: the design system and every screen in [docs/05](05-frontend.md).)*

## 6. Brief format

One file per worker in `.slipstream-briefs/`, mirroring legios' `w1-protocol.md` convention. Every brief has exactly these sections:

```markdown
# W7 — Polymarket read adapter

## Decision (already made — implement, do not revisit)
<the design call, stated flatly, with the doc reference>

## Files you own
packages/venues/src/polymarket/read.ts
packages/venues/src/polymarket/quantize.ts
packages/venues/src/polymarket/__tests__/**

## Out of scope — other workers own these, do not edit
packages/venues/src/types.ts        (Opus — the interface you implement)
packages/venues/src/hyperliquid/**  (W6)
packages/shared/src/money/**        (W1)

## Read first
docs/02-venues-and-data.md §3, §4, §5

## Definition of done
pnpm test venues/polymarket   # green
pnpm typecheck                # green
<plus the concrete observable from the wave table>

## Known traps
- CLOB V2 only. Anything dated before May 2026 is wrong about signing.
- Four REST hosts, four data models. Gamma ≠ CLOB ≠ Data API ≠ Leaderboard.
- Never `number` for money. Never `parseFloat`. See docs/02 §5.
```

**Vocabulary discipline.** A word meaning two things is where a cold worker confidently deletes a true statement. This codebase's live ambiguities, to be disambiguated in every brief that touches them:
- **"position"** — the leader's, or the follower's. Always qualify.
- **"signer" vs "owner" vs "funder"** — three distinct addresses on Polymarket ([02 §3](02-venues-and-data.md)).
- **"market"** — an HL perp asset, or a PM binary outcome. Always venue-qualified.
- **"close"** — trading out of a position, or a PM market *resolving*. Never interchangeable ([03 §5](03-copy-engine.md)).

## 7. Review protocol

**Mechanical first, always.** `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`, plus the grep sweeps: no `number` in money paths, no unscoped DB queries, no key-shaped strings in log fixtures. These catch most defects at zero model cost, and running a reviewer before them wastes it.

**Then review the diff, not the report** — against the definition of done, then for what tests structurally cannot catch: concurrency, ordering, silent failure, swallowed errors, and claims in comments that the code does not support.

**Depth is graded by blast radius:**

| Territory | Review |
|---|---|
| `vault`, `exec`, `risk`, `copy`, `money`, venue write paths | **Adversarial.** A reviewer instructed to *refute* the change, required to produce a concrete failure scenario or nothing |
| `db` migrations, `engine` wiring | Careful read, with attention to ordering and shutdown |
| `tracker`, `notify`, docs, infra | Green tests plus a glance |

**Corrections go back to the worker via `-s <session-id>`, never onto Opus.** The session holds full context, so the corrective brief is two sentences and Opus re-checks only the delta. Taking the fix back onto Claude throws away the entire saving.

## 8. Parallel safety

Five concurrent workers share one working tree. That is safe **only** because territories are disjoint and each brief names the others' files as out of scope. Two cases break the partition and get `git worktree` isolation instead:

- Any wave where two workers must both touch `packages/venues/src/types.ts` — which should never happen, because Wave 0 fixed it.
- Wave 3, where W11 and W12 both add to `packages/venues`. Their subdirectories are disjoint, so a shared tree is fine; a shared *barrel export file* would not be, so the barrel is written in Wave 0 with both exports already present and pointing at files that do not yet exist.

That last trick — pre-writing the barrel so no two workers ever edit the same file — is worth applying wherever a shared index file would otherwise become a merge point.

## 9. What "done" means for the fleet

A wave is complete when every worker's definition-of-done command passes **on a clean checkout**, not on the machine that built it, and the diff has had the review depth its blast radius calls for. Not when the workers report success. Several will report nothing at all.
