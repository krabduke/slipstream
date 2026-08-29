# S2 — Spike: can we verify a Hyperliquid agent delegation from a third party?

> Research spike. **No credentials.** All Hyperliquid `/info` calls below are unauthenticated,
> read-only, and were made **live on 2026-08-29 (~16:35–16:38 UTC) against
> `https://api.hyperliquid.xyz/info`**; quoted responses are verbatim. Researched 2026-08-29.

**Question:** Slipstream's security model ([04 §1](../04-security-and-custody.md)) rests on refusing
to store any key it has not verified is a delegated, non-owner signer. Can we — holding only a
master address and a candidate agent address — *prove* that delegation programmatically before
storing the key?

**TL;DR:** Yes, on Hyperliquid, and more strongly than docs/04 assumed. Two public `/info` calls
(`userRole` and `webData2`) let a third party confirm, bidirectionally, that a candidate address is
a registered agent of a specific master and is *not* the master/sub-account/vault. The
"cannot-withdraw" property is enforced structurally by Hyperliquid's two-signature-scheme design
plus the destination-pinned `agentSendAsset` action — not merely by convention — though the docs
state it by construction rather than in one explicit sentence. Polymarket's newer **Session Keys**
assert the same cannot-withdraw property in official docs, but a *third party* cannot verify the
delegation as independently as on Hyperliquid — see Q5.

---

## 1. Which `/info` request returns an account's registered agents?

There is **no single documented, purpose-built "list agents of a master" endpoint.** Two calls
cover the two directions, and they differ in strength:

### 1a. Agent → master (the *documented*, authoritative check): `userRole`

Official docs: <https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint.md>
("Query a user's role"). Request body + the documented response enum:

```jsonc
// request
{ "type": "userRole", "user": "0x<address>" }
```
```
{"role":"user"}                                  // a master / normal account ("user")
{"role":"missing"}                               // unknown address
{"role":"agent",      "data": {"user":   "0x..."}}   // an agent; data.user == its master
{"role":"subAccount", "data": {"master": "0x..."}}   // a sub-account; data.master == its master
{"role":"vault"}                                 // a vault address
```

**LIVE (2026-08-29), verbatim** — the exact positive case the docs describe:

```jsonc
// userRole on an agent address
{"role": "agent", "data": {"user": "0x85ecf584f25db6f146718b86d493e33c5af72052"}}
// userRole on that master address
{"role": "user"}
// userRole on a vault address (0xdfc24b07…community vault)
{"role": "vault"}
```

This is the disambiguator for the "agents vs sub-accounts vs vaults" trap: `userRole` returns a
**distinct role** for each, and only `"agent"` is what Slipstream wants to store.

### 1b. Master → its agent list (live-confirmed but *undocumented* schema): `webData2`

`webData2` is the frontend aggregate (historically `userInfo`). It is public/unauthenticated and
**does** return the master's registered agents — but it is *not* in the documented
`/info` type list, so treat its schema as subject to change.

```jsonc
// request
{ "type": "webData2", "user": "0x<master>" }
```
**LIVE (2026-08-29):** top-level keys returned for a whale account:
```
['agentAddress', 'agentValidUntil', 'assetCtxs', 'clearinghouseState', 'cumLedger',
 'isVault', 'leadingVaults', 'meta', 'openOrders', 'perpsAtOpenInterestCap',
 'serverTime', 'spotState', 'totalVaultEquity', 'twapStates', 'user']
```
For accounts with one (unnamed) agent, `agentAddress` is a **bare string** and `agentValidUntil`
a **millisecond timestamp** — observed across 12 leaderboard accounts, e.g.:
```jsonc
// webData2("0x85ecf584…")
{ "agentAddress": "0x7c15ee83f082a967c8f99e84f1a04a9d1766f7f4",
  "agentValidUntil": 1788868755579 }   // = 2026-09-08T11:59Z
```
For accounts with no agents both fields are `null` (verified on several). I did **not** capture an
account with multiple/named agents, so I could not confirm whether `agentAddress` becomes an array
and whether *names* surface here — **flag for W6/W7: normalise `string | string[] | {…}[]`.**
Names are not needed by `verifyDelegation` anyway (it only proves "registered agent of master M,
not M itself").

> **Docs note / pitfall** (info-endpoint.md, "User address"): *"To query the account data
> associated with a master or sub-account, you must pass in the actual address of that account. A
> common pitfall is to use an agent wallet's address which leads to an empty result."* — i.e. you
> cannot read a *master's* agent list by querying the agent; that's what `userRole` is for.

---

## 2. Can we confirm a given agent address is registered to a given master?

**Yes — and it names the master, so this is the strong guarantee, not the weak "lists agents
without saying whose".** Two independent, third-party, unauthenticated checks, and they cross-check
each other:

1. **From the agent side (authoritative):** `userRole(agent)` must return
   `role == "agent"` **and** `data.user == master`. The `data.user` field *is* the master address
   (live-confirmed §1a). This positively binds agent→master.
2. **From the master side:** `webData2(master).agentAddress` must contain `agent`
   (live-confirmed §1b).

Plus the **"is this actually a non-owner signer?"** gate that docs/04 demands — all cheaply
checkable in one `userRole(agent)` call:
- `role == "agent"` (rejects `user`/`missing` → candidate is the owner EOA or unknown),
- `data.user == master` (rejects an agent belonging to *some other* master),
- `agent != master` (sanity), and role is **not** `subAccount`/`vault` (those are different
  permission models — the trap).

If someone submits the **master's own address** as the "signer," `userRole` returns
`{"role":"user"}` → reject. That is exactly the "refuse to store an owner key" rule, and it is
programmatic and fails closed.

**Guarantee strength:** this is genuinely third-party — we never need the agent to sign anything or
prove key possession; we only need the two addresses. The one thing `/info` does *not* prove is
**key possession** (that Slipstream actually holds the private key for the agent address). For
`verifyDelegation(owner, signer)` that is fine: the browser supplies the private key out-of-band and
the delegation status is what must be verified. If possession proof is ever wanted, ask the agent to
sign a nonce challenge — but that is *not* required for the §1 rule.

---

## 3. Is "an agent cannot withdraw" enforced by the protocol, or a convention?

**Enforced by protocol structure — this is the best evidence available and it is strong, but note
the honest gap: Hyperliquid's docs do not contain one literal sentence "an agent cannot withdraw."**
The property is established by construction, from three official-docs facts (Exchange endpoint:
<https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint.md>; Signing:
<https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/signing.md>; API wallets:
<https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets.md>):

1. **Two signature schemes, and an agent only has the weaker one.** Signing.md:
   *"there are two signing schemes (the Python SDK methods are `sign_l1_action` vs
   `sign_user_signed_action`)."* Trading/order/cancel actions are L1 actions an agent signs. The
   fund-moving and authority-changing actions are **user-signed** — each carries
   `hyperliquidChain` + `signatureChainId` (an on-chain signature by the account's *own* key, e.g.
   on Arbitrum `0xa4b1`), which an agent cannot produce:
   - `withdraw3` (initiate withdrawal): requires `hyperliquidChain`, `signatureChainId`, `destination`.
   - `usdClassTransfer` (spot↔perp), `cDeposit`/`cWithdraw` (staking), `approveAgent`,
     `approveBuilderFee`: all user-signed with `signatureChainId`.
   There is **no** agent-signable withdrawal action.
2. **The one transfer an agent *can* sign is destination-pinned to the owner's own account.**
   Exchange endpoint, "Agent Send Asset" (verbatim): *"Similar to send asset, but can be signed by
   an agent. **Destination must match the source address.** … Only the collateral token can be
   transferred to or from a perp DEX."* So `agentSendAsset` can only move funds *between the same
   owner address's* perp-DEX and spot balances — never to an external/attacker address. The existence
   of this deliberately-restricted variant, separate from the user-only `sendAsset`, is the clearest
   signal the protocol distinguishes "internal shuffling an agent may do" from "money leaving the
   account an agent may not do."
3. **API wallets "are only used to sign"** (nonces-and-api-wallets.md) and **hold no funds** — they
   act on behalf of the master/sub-account; the balance lives under the master, which is the only
   key that can sign the withdrawal. The `withdraw3` destination is signed on-chain by the owner;
   L1 validators forward it to the bridge.

**Assessment for the product:** this is *protocol-enforced*, not a client-side convention — the
L1 validators check the signing scheme, and there is no agent path to an external destination. That
is materially stronger than the "a blog post asserts it" weak evidence the brief warned about.
**Honest limitation:** I had no credentials, so I could not *empirically* attempt an agent-signed
`withdraw3` and observe the rejection; the conclusion rests on the documented two-scheme split and
the absence of any agent-withdrawable action. W6/W7 should add a live "attempt withdrawal as agent →
expect rejection" test once a throwaway agent exists, to convert structural evidence into empirical.

---

## 4. Agent expiry and naming

### Naming (confirmed — this is our rotation primitive)
`approveAgent` docs (Exchange endpoint, "Approve an API wallet", verbatim field description):
> *"Optional name for the API wallet. An account can have **1 unnamed** approved wallet and up to
> **3 named** ones. And additional **2 named agents per sub-account**. A custom expiration can be
> set by appending `valid_until {timestamp}` after the name."*

Rotation: per nonces-and-api-wallets.md ("API wallet pruning"),
> *"an existing **unnamed** API Wallet is deregistered when an ApproveAgent action registers a new
> unnamed wallet; … an existing **named** API Wallet [is deregistered] when an ApproveAgent action
> is sent with a **matching name**."*

So re-approving the same name atomically replaces the previous key — matches docs/04 §3.
**Security note from the same page:** *"it is strongly suggested to **not reuse** [agent] addresses
… previously signed actions can be replayed once the nonce set is pruned."* → on rotation, generate a
fresh keypair; do not reuse the old agent address.

### Expiry (confirmed — agents are not permanent)
- Agents **expire**: pruning reasons include *"The wallet expires"* and *"the account that registered
  the agent no longer has funds"* (nonces-and-api-wallets.md). So a drained/emptied master can silently
  lose its agents.
- Custom TTL via `valid_until {timestamp}`, capped: **"The expiration can be at most 180 days in the
  future"** (Exchange endpoint).
- `webData2` exposes the resulting deadline as `agentValidUntil` (ms). **LIVE:** observed
  `agentValidUntil = 1788868755579` → `2026-09-08T11:59Z`, **~9.8 days ahead** of the query — i.e.
  real accounts do carry near-term expiries.

**Detecting a stale/expired agent (for W6/W7):**
- At verification time, compare `webData2(master).agentValidUntil` to `now`; reject/prune if past or
  within a safety margin. Re-check periodically (it is *not* a one-time property).
- Also re-poll `userRole(agent)` + membership in `master.agentAddress`: expiry, re-approval
  (rotation), or the master emptying its balance **prune** the agent, after which these reflect it.
- **Not found / do not assume:** a *default* TTL when `valid_until` is omitted is **not documented**;
  the ~10-day value above is likely a custom `valid_until`, not a network default. Treat
  `agentValidUntil` as the source of truth at runtime rather than assuming a fixed lifetime.

---

## 5. Polymarket — can a third party verify a deposit-wallet session signer is not the owner EOA?

**Update vs. the assumptions in [04 §1](../04-security-and-custody.md) and
[S1](s1-polymarket-v2.md):** Polymarket now ships a dedicated delegated-signer primitive — **Session
Keys** — which is the real analog to a Hyperliquid agent, and its official docs contain the explicit
"cannot withdraw" sentence that [04 §1] doubted was provable. So the *security property* is stronger
than feared; what remains weaker than Hyperliquid is **independent third-party verification**. No
new endpoint/order shape was tested (no credentials) — this is from official docs, fetched 2026-08-29.

Sources: Session Keys <https://docs.polymarket.com/trading/session-keys>;
Wallets & Authentication <https://docs.polymarket.com/trading/wallets-auth>;
Contracts <https://docs.polymarket.com/resources/contracts>.

### The model (three addresses, not two)
1. **Deposit Wallet Owner EOA** — the personal wallet that owns the smart wallet and is the only
   authority that can withdraw / authorize sessions.
2. **Deposit Wallet** — a smart-contract wallet (POLY_1271 / `DEPOSIT_WALLET`, `WalletType 3`) that
   *holds* the funds and is the order `maker`. Beacon-proxy `0x7A18EDfe055488A3128f01F563e5B479D92ffc3a`,
   factory `0x00000000000Fb5C9ADea0298D729A0CB3823Cc07` (pre-2026-06-29 were UUPS proxies).
3. **Session Key** — a *separate EOA* the owner authorizes to trade. **This is the key Slipstream would store.**

### "Cannot withdraw" — now officially asserted
Session Keys page, verbatim:
> *"A Session Key is a separate signer that a Deposit Wallet Owner authorizes to trade for a Deposit
> Wallet. It lets an integration perform routine trading without using the owner's key. **A Session
> Key cannot withdraw funds from the Deposit Wallet.**"*

It is enforced by **scoping**: a session key is granted only `CLOB` / `COMBOSRFQ` / `ALL` *trading*
scopes — **there is no withdrawal scope** — and authorization/revocation are on-chain calls
(`authorizeSessionSigner(address,uint256)`, `revokeSessionSigner(address)`) executed by the deposit
wallet under the **owner's** signature. Expiry is fixed: *"validUntil … the current whole Unix
timestamp in seconds plus 180 days. Other values are rejected."* So: can't-withdraw, scoped,
time-limited (180 d), revocable — structurally very close to a Hyperliquid agent.
**Caveat:** this is an official-docs assertion + structural scoping, not something I empirically
confirmed by attempting a session-key withdrawal (no credentials), and the CTF Exchange V2 audits
(Quantstamp/Cantina, Mar 2026) cover order settlement, not a session-signer withdrawal guarantee.

### What a *third party* (Slipstream) holding only {deposit wallet, candidate signer} can verify

| Claim | Third-party verifiable? | How / why not |
|---|---|---|
| Candidate signer **≠ owner EOA** | ✅ yes, trivially | address inequality (needs the owner address) |
| The funder **is a real Polymarket deposit wallet** | ✅ yes, public Polygon RPC, no auth | `eth_getCode` (contract) + CREATE2 re-derivation from owner→factory/beacon |
| Candidate is an **active, unexpired, non-revoked** session key **of that wallet**, with what scopes | ⚠️ **not without cooperation** | the only readback is `GET https://clob.polymarket.com/v1/user/session-signers` → `{wallet, signers:[{address,scopes,valid_until}]}`, but it is **owner-L2-authenticated** and returns *only the caller's own wallet*. There is **no public `userRole`-style registry** |
| "Owner authorised this signer" (cryptographic) | ⚠️ partially | the owner can present the EIP-712 `DepositWallet/Batch` signature over `authorizeSessionSigner(candidate, validUntil)`; Slipstream recovers the signer (must == owner EOA) and checks the calldata. This proves the authorisation was *signed*, but the batch `deadline` is short-lived and this artifact does **not** reflect later revocation/expiry. |
| On-chain read of current session-key state | ❓ **unconfirmed** | the authorisation lives in the deposit-wallet contract, so an on-chain getter *should* exist — but **no public session-signer getter/event is documented** in the sources read, and `contracts.md` does not list the DepositWallet ABI. Needs the verified implementation ABI to confirm before relying on it. |

### Honest summary for Polymarket
The *property* docs/04 §1 needs (delegated signer, cannot withdraw) is now **officially stated and
structurally scoped** — a genuine improvement over the §1/S1 picture. But **independent,
unauthenticated verification of the delegation is weaker than Hyperliquid**: Hyperliquid exposes
`userRole`/`webData2` that anyone can call to confirm "this address is a registered non-owner agent
of master M"; Polymarket's equivalent list is gated behind the owner's CLOB credentials, the feature
is **beta**, requires a **Builder API key allowlisted for session-key management**, and works **only
for Deposit Wallets** (legacy Safe/Proxy migration "planned"). So Slipstream can *always* cheaply
confirm `signer ≠ owner` and that the funder is a deposit wallet, and can *accept* an
owner-signed authorization — but cannot, on its own, confirm live non-revoked delegation the way it
can on Hyperliquid.

This lands squarely on the fallback [04 §1] already specified: **verify the owner-EOA mismatch, and
gate Polymarket key entry behind a consent screen naming the residual risk; do not treat it as
equivalent to the Hyperliquid guarantee.**

---

## Implications for `verifyDelegation` (W6/W7 hand-off — no code written here)

**Hyperliquid — implement as:** call `userRole(signer)` and require
`role === "agent" && checksum(data.user) === checksum(owner) && signer !== owner`;
optionally cross-check `webData2(owner).agentAddress` contains `signer`, and require
`agentValidUntil > now + margin`. This is a pure read, no credentials, fails closed. Handle
`agentAddress` being `string | string[]`; reject `role` `user`/`subAccount`/`vault`/`missing`.
Track the agent's `agentValidUntil` and re-poll (expiry/rotation/empty-account pruning). On rotation
issue a **fresh** keypair (docs warn reusing a deregistered agent address risks replay of pruned
nonces).

**Polymarket — minimum verifiable gate:** `sessionSigner !== ownerEoa` **and** funder resolves to a
real deposit wallet (CREATE2 from `factory 0x0000…Cc07` / `beacon 0x7A18…fc3a`, and `eth_getCode != 0x`).
To bind the delegation without owner API creds, either require the owner-signed
`authorizeSessionSigner(signer, validUntil)` EIP-712 batch and recover it to the owner EOA, **or**
confirm (once a DepositWallet ABI is available) an on-chain session-signer getter. Derive selectors
from the documented signatures (`toFunctionSelector("authorizeSessionSigner(address,uint256)")`,
`toFunctionSelector("revokeSessionSigner(address)")`) — **I could not compute the hex selectors here
(no keccak lib available); do not trust any value you did not generate yourself.** Until the on-chain
readback is confirmed, keep the consent screen.

---

## VERDICT

- **HYPERLIQUID: VERIFIABLE.** A third party holding only (master, candidate agent) can prove
  delegation programmatically with no credentials: `userRole(agent)` returns `role="agent"` with
  `data.user` equal to the master (live-confirmed 2026-08-29), and `webData2(master).agentAddress`
  lists it; the cannot-withdraw property is enforced by protocol structure (withdrawals are
  user-signed `signatureChainId` actions; the only agent transfer action, `agentSendAsset`, pins
  destination to the source address) — not a convention.

- **POLYMARKET: PARTIALLY VERIFIABLE.** Polymarket's Session Keys now officially cannot withdraw
  (scoped to trading only, 180-day expiry, revocable, authorized on-chain) — materially better than
  [04 §1] assumed — but a third party cannot *independently* confirm live, non-revoked delegation the
  way it can on Hyperliquid: the only documented session-signer readback
  (`GET /v1/user/session-signers`) is owner-authenticated, there is no public `userRole`-style
  registry, the on-chain getter is unconfirmed, and the feature is beta/deposit-wallet-only/Builder-gated.
  Verifier can always prove `signer ≠ owner` and that the funder is a real deposit wallet; keep the
  consent-screen fallback for the residual.
