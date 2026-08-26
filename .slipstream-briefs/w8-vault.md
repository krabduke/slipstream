# W8 — Key vault: envelope encryption

## Decision (already made — implement, do not revisit)

Implement `KeyVault` from `packages/vault/src/types.ts` (fixed) in all three backends. Replace the stubs in `aws.ts`, `gcp.ts`, `local.ts`.

Envelope encryption, exactly as specified:
```
DEK    = crypto.randomBytes(32)                 -- fresh per seal, never reused
cipher = AES-256-GCM(DEK, plaintext, iv, aad)   -- aad is the venue_account_id
stored = { ciphertext, iv, tag, wrappedDek, kmsKeyId, aad }
```

- **AWS/GCP** wrap the DEK via their KMS. Those SDKs are **not installed** — implement the backend so it compiles and throws a clear "SDK not installed" error at construction if the module is absent, using a dynamic `import()`. Do not edit `package.json`.
- **`local.ts`** wraps the DEK with a master key read from an env var, for self-hosters. It must log a loud warning at construction that it is not equivalent to a KMS.

`withKey` is the only decryption path and takes a callback. The plaintext is passed *into* the callback and never returned, so no caller can obtain a long-lived plaintext handle. Zero the buffer after the callback resolves, including when it throws.

## Files you own
```
packages/vault/src/{aws,gcp,local}.ts
packages/vault/src/__tests__/**
packages/vault/src/crypto.ts        (shared envelope logic — create it)
```

## Out of scope — do not edit
```
packages/vault/src/types.ts     Opus — fixed
packages/vault/src/index.ts     Opus — barrel
packages/shared/**              W1/W3
```

## Read first
`packages/vault/src/types.ts`, `packages/shared/src/secret.ts`, `docs/04-security-and-custody.md` §2 and §3.

## Definition of done
```bash
pnpm typecheck && pnpm test
```
Plus these specific tests, which are the point of the module:
- seal → withKey round-trips the exact plaintext (local backend).
- **Decrypting with the wrong `aad` fails** and throws — it must not return garbage. This is what binds a ciphertext to its row.
- **Tampering with one byte of `ciphertext` fails authentication** rather than decrypting.
- Two seals of the same plaintext produce different ciphertexts (fresh DEK and IV each time).
- `withKey` does not return the key, and the key is not reachable after it resolves.

## Known traps
- **AES-256-GCM, not CBC, not ECB.** Authenticated encryption is the requirement — a tampered ciphertext must fail, not decrypt to something that later gets signed and sent to an exchange.
- **Never reuse an IV with the same key.** Fresh random IV per seal, always.
- **Never log any of: plaintext, DEK, unwrapped DEK, or the SignerKey.** Not at debug level, not in an error message, not in a `cause`.
- Do not add a method that returns plaintext directly. If you find yourself wanting one, the design is telling you something.
- `local.ts` must fail loudly if its master-key env var is missing. Never generate one silently — a silently-generated key means yesterday's ciphertext is unreadable today.
