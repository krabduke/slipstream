# W10 — SIWE authentication

## Decision (already made — implement, do not revisit)

Implement Sign-In With Ethereum (EIP-4361) for the Next.js control plane. **`apps/web` does not exist yet — you are creating it.** Scaffold the minimum Next.js 15 App Router app needed to host the auth routes: `apps/web/package.json` is the ONE package.json you may create (nothing else may edit any package.json). Keep dependencies to `next`, `react`, `react-dom`, `viem`, `zod`, `jose`. If installing is not possible, write the code so it compiles against the types and say so in your final message.

Flow:
1. `GET /api/auth/nonce` → generate a random nonce (≥8 alphanumeric chars), store it in Postgres `siwe_nonces` with a short expiry, return it.
2. `POST /api/auth/verify` → receives `{ message, signature }`. Parse the EIP-4361 message, verify with `viem`'s `verifyMessage`, and check: domain matches, chainId matches, nonce exists, nonce is unexpired, nonce is unused. **Mark the nonce used in the same transaction that validates it** — a nonce that can be verified twice is not a nonce.
3. On success, upsert the user, issue a short-lived JWT (`jose`) in an **httpOnly, Secure, SameSite=Lax** cookie.
4. `POST /api/auth/logout` clears it.
5. A `requireUser(req)` helper returning the `UserId`, for other routes to use.

Also implement **step-up**: `requireFreshSignature(req)`, which demands a SIWE signature issued within the last 5 minutes. Adding a key, raising a risk limit, and switching to live mode will all use it. A stolen session cookie must not be enough to increase someone's exposure.

## Files you own
```
apps/web/package.json          (the only package.json you may create)
apps/web/next.config.ts
apps/web/tsconfig.json
apps/web/src/lib/auth/**
apps/web/src/app/api/auth/**
apps/web/src/app/layout.tsx    (minimal — visual design is Opus's, keep it bare)
```

## Out of scope — do not edit
```
Any other package.json          — every other worker is forbidden too
apps/web/src/components/**      Opus — the entire frontend design
apps/web/src/app/(app)/**       Opus
packages/db/src/schema.ts       Opus — siwe_nonces already exists, use it
packages/**                     other workers
```

**Do not design any UI.** No styling, no layout, no copy beyond what a route handler returns. A bare `layout.tsx` that renders `{children}` is exactly right. The frontend is built separately by a human; anything decorative you add will be deleted.

## Read first
`docs/04-security-and-custody.md` §5, `packages/db/src/schema.ts` (`users`, `siwe_nonces`), `docs/01-architecture.md` §2.

## Definition of done
```bash
pnpm typecheck && pnpm test
```
Plus tests proving: a replayed nonce is rejected; an expired nonce is rejected; a signature from a different address than the message claims is rejected; a message for the wrong domain is rejected.

## Known traps
- **The nonce must be single-use, enforced atomically.** Check-then-mark in two statements races. Use a conditional update that returns whether it won.
- **Verify the address recovered from the signature equals the address in the message.** Verifying only that the signature is *valid* proves nothing about who signed it.
- **Check the domain and chainId.** A signature harvested by a phishing site for another domain must not authenticate here.
- Never put the JWT in localStorage or a non-httpOnly cookie.
- Do not log the signature, the message, or the token.
- Addresses are stored lowercase. Normalise before lookup.
