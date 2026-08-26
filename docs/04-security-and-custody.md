# 04 — Security and Custody

You chose a hosted service. That means Slipstream holds trading credentials for people who are not you, which is the highest-consequence decision in this plan. Everything below exists to make the worst realistic outcome "some users got trades they didn't want" rather than "the database leaked and everyone was drained".

## 1. The rule everything rests on: we only accept keys that cannot withdraw

Both venues provide a delegated signer that can trade but provably cannot move funds:

- **Hyperliquid — agent wallets.** Created by `approveAgent`, signed once by the master wallet and recorded on-chain. The agent holds no funds and cannot withdraw; only the master can authorise withdrawals. Re-approving the same agent *name* replaces the previous key, which is our rotation primitive.
- **Polymarket — deposit-wallet session signer.** In the POLY_1271 flow the signer and the funder are different addresses. The owner EOA is the only authority that can withdraw; a session signer can place orders and nothing else.

**The rule, enforced in code:**

> Slipstream refuses to store any key it has not verified is a delegated, non-owner signer. No owner EOA private keys. No seed phrases. No exceptions, no "advanced mode", no support-ticket override.

`VenueAdapter.verifyDelegation(owner, signer)` runs *before* the key is ever written:
- **Hyperliquid:** query the master's registered agents via `/info` and confirm the derived address appears there and is not the master itself.
- **Polymarket:** confirm the signer address differs from the deposit-wallet owner EOA and that the deposit wallet resolves to the claimed owner.

If verification fails, or the check itself errors, the key is discarded and never touches Postgres. **Fails closed.**

**Honest limitation.** For Polymarket, full third-party verification of "this signer cannot withdraw" is not something I could confirm is possible from public documentation, and there are open SDK issues around POLY_1271 binding API keys to the EOA rather than the deposit wallet. Phase 0 contains a spike to settle it. If it cannot be verified programmatically, the fallback is: verify the owner-EOA mismatch (which we *can* do), gate Polymarket key entry behind an explicit consent screen naming the residual risk in plain language, and never silently treat it as equivalent to the Hyperliquid guarantee.

## 2. Key generation and handling

**The user's browser generates the agent key. The server never sees a plaintext key over the wire in a form it could have chosen.**

```
1. Browser generates a fresh keypair locally (viem, WebCrypto entropy).
2. User signs approveAgent with their own wallet — their master key never leaves their wallet.
3. Browser POSTs {agentPrivateKey, ownerAddress} over TLS to /api/keys.
4. Server verifies delegation on-chain. Fails → 400, nothing stored.
5. Server envelope-encrypts and stores. Plaintext is zeroed.
6. Browser clears the key from memory and never persists it.
```

Step 3 is the uncomfortable one and there is no way around it in a hosted model: a server that must trade unattended must be able to sign unattended. What we can do is bound the damage (§1), bound the exposure window, and never let that plaintext exist anywhere except the two moments it must.

**Handling rules, testable:**
- Plaintext keys exist only in engine process memory, only for the duration of a signing operation, and are zeroed after.
- The Next.js app **never** decrypts. It has no KMS decrypt permission. Compromising the website does not yield keys.
- Keys are never logged, never in error messages, never in stack traces, never in an exception's `cause`. Enforced by an **allowlist** log redactor: fields must be explicitly opted in to being logged. A denylist eventually leaks through a field someone forgot to add.
- No key material in URLs, query strings, or analytics.
- A CI test greps build artefacts and log fixtures for anything shaped like a private key.

## 3. Envelope encryption

Per-user data keys, wrapped by a KMS master key:

```
DEK    = random 256-bit, unique per venue_account, never reused across users
cipher = AES-256-GCM(DEK, plaintextKey, iv, aad = venue_account_id)
stored = { ciphertext, iv, tag, wrapped_dek = KMS.encrypt(CMK, DEK), kms_key_id }
```

- **AES-256-GCM** — authenticated encryption; a tampered ciphertext fails to decrypt rather than decrypting to garbage that gets signed.
- **`aad = venue_account_id`** binds the ciphertext to its row, so a swapped row fails authentication instead of using the wrong user's key.
- **One DEK per venue account**, never shared. Compromise is contained.
- **Plaintext DEK is discarded immediately** after use, never cached to disk.
- **Database theft alone is insufficient** — an attacker holds ciphertext and wrapped DEKs, and without KMS decrypt permission cannot get further.

`packages/vault` exposes a `KeyVault` interface with three implementations: **AWS KMS**, **GCP KMS**, and **local file** (self-hosters, with a loud startup warning that it is not equivalent). Provider portability again — and the local implementation means the OSS project is genuinely usable without a cloud account.

**Rotation:** re-approving a same-named Hyperliquid agent replaces the old key on-chain. The UI exposes "rotate key" as a one-click flow, and rotation is mandatory-prompted after any security advisory. Old ciphertext is deleted, not archived.

## 4. Threat model

| Threat | Mitigation | Residual |
|---|---|---|
| Database dump leaks | envelope encryption; keys useless without KMS | attacker learns positions and strategy configs — a privacy loss, not a financial one |
| Website (Next.js) compromised | no decrypt permission, no key access, cannot place orders directly | attacker can write malicious *intents* → mitigated by engine-side risk gate re-check and per-user caps |
| Engine compromised | worst case, since it holds decrypt rights | **bounded by §1: the attacker can trade, not withdraw.** Contained further by per-user caps, kill switch, and anomaly alarms on unusual order flow |
| KMS credentials leak | short-lived instance credentials, no long-lived keys in env; CMK usage alarmed | full compromise if combined with a DB dump — this is the scenario that must be alarmed on, hence CMK decrypt-rate monitoring |
| Malicious/compromised dependency | lockfile pinning, `npm audit` in CI, minimal dependency surface in `vault` and `venues`, no postinstall scripts allowed | supply chain remains the hardest problem; the small blast radius of §1 is the real backstop |
| User's own wallet drained elsewhere | out of scope — we never hold master keys | none |
| Insider (you, or an agent with repo access) | audit log, no plaintext access path in normal operation, KMS access separated from repo access | a determined operator with production KMS access can trade users' accounts. Disclosed honestly in the ToS |
| Replay of a signed order | venue nonces; idempotency keys; per-user execution lock | — |
| Session hijack | SIWE + short-lived JWT in httpOnly/SameSite cookie; re-signature required for sensitive actions | — |

**The line worth internalising:** every row's worst case is "unwanted trades", never "funds gone". That is entirely because of §1, and it is why §1 has no override.

## 5. Authentication and authorisation

- **SIWE (EIP-4361)** — the user signs a message containing domain, address, chain id, a server-issued nonce (Redis, single-use, short TTL) and issued-at. The server verifies via `viem`, then issues a short-lived JWT in an httpOnly, Secure, SameSite=Lax cookie. Note SIWE is migrating toward SIWX for multichain; we implement the standard EIP-4361 flow and keep verification behind an interface.
- **Step-up signature** required for: adding or rotating a key, raising any risk limit, and enabling live (non-paper) mode. A stolen session cookie should not be enough to increase someone's exposure.
- **Every query is tenant-scoped** at the data-access layer, not in route handlers. `packages/db` exposes only functions taking an explicit `userId`; there is no unscoped query helper to reach for. Postgres row-level security as a second, independent line.
- **Rate limiting** on auth, key entry, and intent creation, per address and per IP.

## 6. Kill switches

Three levels, all reachable in one click, all effective in under a second:

| Level | Who | Effect |
|---|---|---|
| Per-subscription | user | stop copying this leader; open positions remain, exits still process |
| Per-user "panic" | user | stop all opening; **optionally flatten everything** |
| Global | operator | halt all opening across all users |

Stored in Redis (instant) *and* Postgres (durable). The engine treats "either says stop" as stop, and re-reads on every planner tick. A kill switch **never blocks an exit** ([03 §5](03-copy-engine.md)) — halting is about not taking new risk, and a switch that trapped users in positions would be the opposite of a safety feature.

Also required: a **dead-man's switch**. If the engine cannot reach Postgres or a venue for longer than a threshold, it stops opening new positions on its own. An engine that cannot verify state must not act on assumptions.

## 7. Legal and disclosure posture

Engineering can't settle this, but the spec should not pretend it doesn't exist.

- **MIT licensed, provided as-is, no warranty.** Prominent, non-dismissable risk disclosure at onboarding: copy trading loses money for most people; past performance of a wallet predicts nothing; leverage liquidates.
- **We are not an adviser and give no recommendations.** No rankings, no "top traders", no endorsements ([03 §10](03-copy-engine.md)). This is a deliberate product constraint with a legal motive.
- **We are not a custodian** and cannot be, by construction. Say so plainly and explain *why* — the un-withdrawable key story is the best marketing this project has, and it happens to be true.
- **Open question for a lawyer, before the hosted instance takes a stranger's key:** operating a hosted service that automatically trades other people's accounts is plausibly a regulated activity in several jurisdictions, and the `k2capitalmanagement.xyz` domain makes the "are you offering investment services" reading easier rather than harder. Self-hosting is unaffected. Worth an hour of professional advice before launch, not after.
- **Incident policy written before the incident:** what gets disclosed, how fast, to whom. Committed to the repo, so it is a promise rather than an improvisation.
