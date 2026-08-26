# W4 — Local stack, Dockerfiles, CI

Before writing any code, work through the Known traps below and state your plan. Then implement.

## Decision (already made — implement, do not revisit)

Three things.

**1. `infra/docker-compose.yml`** bringing up Postgres 16 and Redis 7 with named volumes, healthchecks, and ports that do not collide with a typical local Postgres (use 55432 and 56379 on the host). The web and engine services are declared but commented out with a note that they land in later waves — do not invent app services that do not exist yet.

**2. Dockerfiles.** `infra/Dockerfile.engine` (multi-stage, Node 22 alpine base, non-root user, no dev dependencies in the final layer). `infra/Dockerfile.web` may be a stub with a comment; Next.js does not exist yet.

**3. CI** at `.github/workflows/ci.yml`: on push and PR, run `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`. Node 22, pnpm via corepack, with the store cached.

**A known problem you must solve:** `pnpm install` currently exits 1 with `ERR_PNPM_IGNORED_BUILDS` for esbuild, even though `onlyBuiltDependencies: [esbuild]` is set in `pnpm-workspace.yaml` and the binary works. Locally this is cosmetic; in CI it fails the build at the first step. Settle it properly — the acceptable answers are getting the allowlist honoured, or committing the approval state pnpm expects. **Not acceptable:** `|| true`, `--ignore-scripts`, or removing the build allowlist entirely.

Also add ESLint flat config with `typescript-eslint`, and one custom rule or `no-restricted-syntax` entry that **bans `parseFloat`, `Number(`, and float literals inside `packages/*/src/**` money and venue paths**. Root `pnpm lint` must run it.

## Files you own

```
infra/**
.github/workflows/**
eslint.config.js
.dockerignore
```

You may modify `pnpm-workspace.yaml` and `.npmrc` **only** to fix the esbuild issue. Do not edit any `package.json` — other workers are running concurrently and it is a shared file.

## Out of scope — do not edit

```
packages/**       W1/W2/W3 and Opus
apps/**           later waves
tsconfig.json     Opus
package.json      W2 owns the db scripts; coordinate by not touching it
```

## Read first

- `docs/01-architecture.md` §4 (portability rule) and §6
- `docs/06-roadmap.md` Phase 0 exit criteria

## Definition of done

```bash
pnpm install      # exit 0, no ERR_PNPM_IGNORED_BUILDS
pnpm lint         # exit 0
pnpm typecheck    # exit 0
pnpm test         # exit 0
```

Plus: `docker compose -f infra/docker-compose.yml config` validates, and the lint rule demonstrably fires — add a fixture file under `infra/` or a test showing `parseFloat` in a money path is an error.

**Docker is not installed on this machine.** Write and validate the compose file by syntax; if you cannot run `docker compose config`, say so plainly in your final message rather than claiming it passed.

## Known traps

- **Do not use Vercel-specific anything.** No Vercel KV, no Vercel Blob, no edge-runtime assumptions. The portability claim in docs/01 §4 is a promise the infra either keeps or breaks.
- Host ports 5432 and 6379 are commonly taken. Use 55432/56379 and put the mapping in the compose file, not in documentation.
- The engine image must run as a non-root user. A container that holds decrypt rights running as root is a bad combination.
- Do not add a healthcheck that only proves the process is alive. Postgres gets `pg_isready`, Redis gets `redis-cli ping`.
- Do not cache `node_modules` in CI. Cache the pnpm store.
