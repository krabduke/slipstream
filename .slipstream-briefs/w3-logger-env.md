# W3 — Structured logger, allowlist redactor, env config

Before writing any code, work through the Known traps below and state your plan. Then implement.

## Decision (already made — implement, do not revisit)

Two small modules, both new.

**`packages/shared/src/log/`** — a structured JSON logger with an **allowlist** redactor. Fields must be explicitly opted in to being logged. A field not on the allowlist is dropped, not masked, not truncated. This is the opposite of the usual denylist approach and it is deliberate: a denylist eventually leaks a key through a field somebody forgot to add. See docs/04 §2.

The allowlist is a static set declared in code. Logging an object filters its keys against that set recursively, and any non-allowlisted key is omitted entirely from the output. Levels: `debug | info | warn | error`. Output is one JSON object per line to stdout.

**`packages/shared/src/env/`** — parse and validate process env with zod, once, at startup. Missing or malformed required variables throw immediately with a message naming every offending variable at once, not one at a time. Never fall back to a default for anything security-relevant (KMS key ids, database URLs, session secrets); defaults are permitted only for genuinely optional tuning values.

`zod` is already a dependency of `packages/shared`. Do not edit any `package.json`.

## Files you own

```
packages/shared/src/log/**
packages/shared/src/env/**
packages/shared/src/__tests__/log.test.ts
packages/shared/src/__tests__/env.test.ts
```



## Out of scope — do not edit

```
packages/shared/src/index.ts                    Opus — tell me what to export, do not edit
packages/shared/src/{brand,secret,notimpl}.ts   Opus
packages/shared/src/money/**                    W1
packages/shared/src/contracts/**                Opus
packages/shared/src/__tests__/invariants.test.ts  Opus
packages/db/**                                  W2
```

## Read first

- `docs/04-security-and-custody.md` §2 and §5
- `docs/01-architecture.md` §6
- `packages/shared/src/secret.ts` — the `SignerKey` type and its handling rules

## Definition of done

```bash
pnpm typecheck    # exit 0
pnpm test         # exit 0
```

Plus these specific tests, which are the point of the module:
- An object containing a key-shaped 64-hex-character string under a **non-allowlisted** field name produces log output that does not contain that string.
- The same string under a **deeply nested** non-allowlisted field is also absent.
- An `Error` with a `cause` chain containing a non-allowlisted field does not leak it — errors are redacted the same way as plain objects.
- `env` parsing reports **all** missing required variables in one throw, not just the first.

## Known traps

- **Allowlist, not denylist.** If you find yourself writing a list of *forbidden* field names, you have built the wrong thing. The test above must pass for a field name you never thought of.
- **Errors are the leak path everyone forgets.** Stack traces, `error.cause`, and thrown objects with extra properties all serialise. Redact them through the same filter as ordinary objects.
- **Never log a `SignerKey`, and do not add a `toJSON` or `toString` to make it "safe to log".** The correct handling is that it never reaches the logger at all.
- Do not log full request bodies, URLs with query strings, or venue API responses verbatim. Pick the fields you need.
- `env` must not read `process.env` anywhere except inside this module. Everything else receives parsed config.
