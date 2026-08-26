# W20 — Self-host guide and deploy recipes

## Decision (already made — implement, do not revisit)

Write `docs/self-host.md` and per-provider recipes under `infra/recipes/`.

The claim in docs/01 §4 is that switching hosts is a connection string plus a deploy recipe. Your job is to make that true and prove it, not to assert it.

`docs/self-host.md` covers: prerequisites, cloning, `.env` setup with **every** variable explained (what it does, what breaks without it, whether it is required), bringing up Postgres and Redis, running migrations, starting web and engine, and the security model in plain language — specifically why the app cannot withdraw funds, since that is the thing a self-hoster most needs to trust.

`infra/recipes/` gets one file each for: Vercel (web) + Railway (engine), Fly.io, Render, and bare Docker Compose on a VPS. Each states exactly which component goes where and why the engine cannot go on Vercel.

## Files you own
```
docs/self-host.md
infra/recipes/**
```

## Out of scope — do not edit
```
docs/0*.md            Opus — the design docs
README.md, PLAN.md    Opus
infra/** except recipes/    W4
any code
```

## Read first
`docs/01-architecture.md` §1 and §4, `docs/04-security-and-custody.md` §1 and §3, `infra/docker-compose.yml` as W4 actually wrote it.

## Definition of done
A reader following `docs/self-host.md` on a clean machine reaches a running instance without asking a question.

Since you cannot test that directly, the proxy is: **every command in the guide is one you have actually run in this repo, or is explicitly marked as unverified.** Walk the guide yourself, run what you can, and mark what you could not. Note that Docker is not installed here, so the compose steps are unverifiable — say so in the document rather than implying you ran them.

## Known traps
- **Do not document commands you have not run.** A self-host guide with a wrong command is worse than none — it burns the reader's trust on step three.
- **Do not describe features that do not exist yet.** Check the code. Several packages are still stubs; the guide must reflect what is actually runnable today, with a clear "not yet implemented" for the rest.
- The `local` KeyVault backend is not equivalent to a KMS. Say so plainly; a self-hoster deserves to know what they are accepting.
- Every env var gets: what it does, what breaks without it, required or optional. A bare list of names is not documentation.
- Do not invent a Vercel setting or a Railway button that you have not confirmed exists.
