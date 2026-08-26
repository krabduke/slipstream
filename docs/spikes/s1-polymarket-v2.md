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

(pending)

## Q3 — If blocked, is there a documented workaround?

(pending)

## Q4 — What credentials and on-chain setup would a real end-to-end test need?

(pending)

## VERDICT

(pending)
