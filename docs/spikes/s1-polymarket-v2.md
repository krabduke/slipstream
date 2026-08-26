# S1 — Spike: can we place a Polymarket CLOB V2 order?

> Research spike. Worker has **no credentials and no funded wallet**; nothing here is
> confirmed by placing a real order unless explicitly stated. All claims carry citations.
> Researched on 2026-08-26.

## Q1 — What does the V2 order struct and signing flow actually require?

**Sources:** official migration doc <https://docs.polymarket.com/v2-migration> (fetched 2026-08-26);
cross-checked against AgentBets V2 migration guide (pub. 2026-05-25, <https://agentbets.ai/guides/polymarket-clob-v2-migration/>),
PolyNode V2 guide (<https://docs.polynode.dev/guides/v2-migration>) and polymarket-php PR #28
(<https://github.com/polymarket-php/polymarket/pull/28>). All four agree on every point below;
all post-date the 2026-04-28 cutover.

### Context

CLOB V2 went live **2026-04-28 ~11:00 UTC** (~1h downtime; all pre-cutover resting orders wiped;
V1-signed orders rejected with `order_version_mismatch`; no backward compat). Production host is
unchanged: `https://clob.polymarket.com`. V2 SDKs: `@polymarket/clob-client-v2` (TS),
`py-clob-client-v2` (Python); the v1 packages only work against V1 and no longer function.

### EIP-712 domain (order signing)

```
name:               "Exchange"
version:            "2"          // bumped from "1"
chainId:            137          // Polygon
verifyingContract:  0xE111180000d2663C0091e4f400237545B87B996B   // CTF Exchange V2, standard markets
                    0xe2222d279d744050d28e00520010520000310F59   // NegRisk CTF Exchange V2
```

Only the *Exchange* domain changed. The `ClobAuthDomain` used for L1/L2 **API auth stays at
version `"1"`** — existing API key/secret/passphrase keep working (migration doc FAQ: "L1/L2
authentication is identical in V2"). A `GET /version` endpoint resolves the active order version
(php SDK PR #28 notes a domain version `"3"` "already rolling out" as of its writing — worth
re-checking at implementation time).

### Signed Order struct (V2)

Dropped vs V1: `taker`, `expiration`, `nonce`, `feeRateBps`. Added: `timestamp`, `metadata`,
`builder`.

```solidity
Order(
  uint256 salt,
  address maker,        // the funder (deposit wallet in our flow)
  address signer,       // see Q2/Q3 — this field is the crux of the whole spike
  uint256 tokenId,
  uint256 makerAmount,
  uint256 takerAmount,
  uint8   side,         // 0 = BUY, 1 = SELL (uint8 here; string "BUY"/"SELL" on the wire)
  uint8   signatureType,// 0 EOA, 1 POLY_PROXY, 2 POLY_GNOSIS_SAFE, 3 POLY_1271
  uint256 timestamp,    // milliseconds; replaces nonce for per-address uniqueness, not an expiry
  bytes32 metadata,     // zero unless needed
  bytes32 builder       // zero unless attaching a builder code
)
```

Notes:

- `expiration` still appears in the `POST /order` JSON body (GTD handling) but is **not part of
  the signed struct**.
- Fees are no longer embedded in the order; operator-set at match time (makers reportedly never
  pay).
- Collateral moved USDC.e → **pUSD** (ERC-20 backed by USDC). API-only integrations must wrap via
  the Collateral Onramp contract (`wrap()`); the UI does it automatically.
- Builder attribution moved from `POLY_BUILDER_*` HMAC headers into the signed `builder` bytes32.
- POLY_1271 (type 3) is **new in V2** and per AgentBets is "the recommended path for new API users
  via Polymarket deposit wallets". Order signing for type 3 wraps the EIP-712 order signature
  ERC-1271-style (`TypedDataSign`) so the deposit-wallet contract can validate it
  (clob-client-v2#64/#66: `buildOrderSignature` ~lines 875–945 of the TS SDK).

### Signature-type table (AgentBets, corroborated by php SDK PR #28 enum)

| Value | Name | Notes |
|---|---|---|
| 0 | EOA | default |
| 1 | POLY_PROXY | Magic Link / email proxy wallets |
| 2 | POLY_GNOSIS_SAFE | Safe-based browser wallets |
| 3 | POLY_1271 | New in V2; deposit wallets; ERC-1271 validation |

**Verdict-relevant nuance already visible:** the SDKs sign *orders* correctly for type 3, but
early issues showed the *API-key registration* path (L1 auth) binding keys to the EOA instead of
the deposit wallet → every order rejected with `the order signer address has to be the address of
the API KEY`. See Q2 for current state.

## Q2 — Does POLY_1271 order placement work today, or is it blocked?

**Answer: it works today (multiple independent production confirmations, July–August 2026,
plus official docs documenting the full flow), but the *shape* that works is not the one the
v1-era intuition suggests, the underlying SDK issues are all still open, and one field
(`signer`) is documented inconsistently. Final confirmation requires a funded test.**

### The enforced invariant

The CLOB enforces **`order.signer == api_key.owner_address`** on every order. The official
API reference lists the exact rejection among `POST /order` error examples:
`"error": "the order signer address has to be the address of the API KEY"`
(<https://docs.polymarket.com/api-reference/trade/post-a-new-order>, `signer_mismatch` example).
Credentials minted through L1 auth bind to the **EOA** (`POLY_ADDRESS = <signer_address>`,
`ClobAuth.address = <signer_address>` — <https://docs.polymarket.com/trading/deposit-wallets>,
API tab). So orders posted under such credentials must carry `signer = EOA`.

### Timeline of the issue cluster

May–June 2026: hard-blocked. A large cluster reported that every deposit-wallet order was
rejected with the error above: clob-client-v2 #63/#64/#65/#66/#67/#73/#75/#83;
py-clob-client-v2 #43/#46/#48/#49/#70/#85/#87/#91 (consolidated root-cause comment:
clob-client-v2#64, comment by maintainer-thread participant). Two failure modes:
`maker address not allowed` (EOA/sig-type-0 attempts — plain EOAs are refused as maker
post-cutover) and `signer != API KEY` (sig-type-3 attempts whose SDK set `signer = funder`).

**State of the tracked issues as of 2026-08-26** (checked directly via GitHub API):

| Issue | State | Last activity |
|---|---|---|
| clob-client-v2#64 | **open** | updated 2026-07-29 |
| clob-client-v2#66 | **open** | updated 2026-07-25 |
| py-clob-client-v2#70 | **open** | active through July |
| py-clob-client-v2#85 | **open** | updated 2026-07-04 |
| py-clob-client-v2#87 | **open** | comments 2026-07-14 |
| py-clob-client-v2#91 | **open** | updated 2026-07-04 |

No maintainer fix to L1-auth binding has shipped in the standalone v2 clients. The issues stay
open while users route around them (see Q3).

### Why reports flipped from "impossible" to "works"

Two things changed between May and July 2026:

1. **Server-side acceptance of the EOA-keyed shape.** clob-client-v2#66, late comment:
   *"as of early July the venue accepts orders where the key is bound to the wallet's owner EOA
   (`signatureType: 3`, `funderAddress` = wallet, creds derived with plain EOA L1 auth) — we've
   been filling in production with stock [clob-client-v2] 1.0.8 since."*
   Independently, py-clob-client-v2#87, comment 2026-07-03 (user `crp4222`, maintainer of OSS
   execution layer pmquant): on **stock `py-clob-client-v2` 1.0.2**, `signature_type=3`,
   `key = EOA`, `funder = deposit wallet`: `create_or_derive_api_key()` falls back to deriving an
   existing **EOA-bound** key (after `POST /auth/api-key` create returns 400 — expected),
   then *"Orders then pass: signer = EOA (matching the api key identity), maker = deposit wallet.
   A dozen matched fills in production since yesterday."* Re-verified same day in #70 (comment
   referenced from #87/#91 threads: *"Running in production daily"*).
   A later #87 comment (2026-07-14) adds failure causes to rule out: funder not actually the
   deposit wallet, unfunded wallet, wrong signature_type, or wallet not yet known to the backend.
2. **The new unified SDK became the supported path.** Polymarket released `@polymarket/client`
   (TS) / `polymarket` (Python) — docs: <https://docs.polymarket.com/dev-tooling/python>. Multiple
   users in py-clob-client-v2#70 report migrating to it fixed order placement ("works for me",
   ×3); one reports a real limit BUY and SELL returning `ok=True, status='MATCHED'` on a migrated
   deposit-wallet account. The official deposit-wallets page now documents connect + credential
   creation for exactly this wallet type (`WalletType.DEPOSIT_WALLET = 3`).

### The `signer` discrepancy — flagged, unresolved

- Current official order-placement docs (<https://docs.polymarket.com/trading/orders/create>)
  give a per-wallet table: Deposit Wallet → `signature_type 3`,
  `maker_address = Deposit Wallet`, **`order_signer_address = Deposit Wallet`**, signed by the
  account signer via `TypedDataSign` ERC-7739 wrapping, with a complete `signatureType: 3` wire
  example.
- Production reports above run `signer = EOA` against EOA-bound keys and fill.
- These are only mutually consistent if the server resolves a deposit wallet to its owner EOA
  when comparing against the API-key owner (or if different credential-creation paths bind keys
  to different addresses). **No source read states the server rule explicitly.** This is exactly
  the kind of claim that cannot be settled from documentation — the funded test (Q4) should try
  `signer = EOA` first (strongest empirical support), then `signer = deposit wallet`.

### Honest limitations

- **No credentials, no funded wallet** — nothing here was confirmed by placing an order.
- One #85 reporter could *not* get the UI-onboarding route to rebind credentials (2026-07-04)
  — but their dump shows they only ever tried `order.signer = deposit wallet` with EOA-bound
  creds, the combination the working reports say fails. Unresolved for that account.
- Deposit-wallet implementation details vary: official docs say UUPS proxy (pre-2026-06-29) vs
  beacon proxy (post); two issue reporters observed EIP-7702-delegated bytecode `0xef0100…`
  (clob-client-v2#64), another an ERC-1967 beacon proxy answering plain ERC-1271
  `isValidSignature` (clob-client-v2#66 comments). Doesn't change the verdict; relevant later
  if we ever craft signatures by hand.

## Q4 — What credentials and on-chain setup would a real end-to-end test need?

(pending)

## VERDICT

(pending)
