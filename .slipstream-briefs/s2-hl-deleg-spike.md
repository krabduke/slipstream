# S2 — Spike: can we verify a Hyperliquid agent delegation from a third party?

This is a **research spike**, not an implementation. Its output is an answer, written to a file.

## FIRST action

Create `docs/spikes/s2-hl-delegation.md` containing just a title and the question headings below. Then research and **append findings as you get them**.

## The question

The entire security model (docs/04 §1) rests on this rule: *Slipstream refuses to store any key it has not verified is a delegated, non-owner signer.* For Hyperliquid the claim is that agent wallets can trade but provably cannot withdraw.

We need to know whether we — a third party, holding only a master address and a candidate agent address — can **prove that delegation programmatically**, before storing the key.

Answer these, each with citations:

1. **Which `/info` request returns an account's registered agents?** Exact request body and response shape. Cite the API docs.
2. **Can we confirm a given agent address is registered to a given master?** If yes, exactly how. If the endpoint only lists agents without naming the master, say so — that is a different, weaker guarantee.
3. **Is "an agent cannot withdraw" enforced by the protocol, or is it a convention?** Cite the strongest source you can find. This is the load-bearing claim of the whole security model and it deserves the best evidence available.
4. **What about agent expiry and naming?** Agents can be named and re-approving a name replaces the previous key. Does an agent expire? If so, after how long, and how would we detect a stale one?
5. **Same five questions for Polymarket**, briefly: can a third party verify that a deposit-wallet session signer is not the owner EOA? Report honestly what is and is not verifiable. Do not overstate.

## Files you own

```
docs/spikes/s2-hl-delegation.md
```

Create nothing else. Do **not** write adapter code — `verifyDelegation` is W6/W7's territory.

## Definition of done

`docs/spikes/s2-hl-delegation.md` answers all five, each claim cited, ending with a one-line **VERDICT** for each venue:

- `HYPERLIQUID: VERIFIABLE` / `PARTIALLY VERIFIABLE` / `NOT VERIFIABLE` — plus one sentence
- `POLYMARKET: VERIFIABLE` / `PARTIALLY VERIFIABLE` / `NOT VERIFIABLE` — plus one sentence

If Polymarket comes back weaker than Hyperliquid, that is an expected and useful result — docs/04 §1 already anticipates it and specifies a consent-screen fallback. Report what is true, not what would be convenient.

## Known traps

- **"Agent wallets cannot withdraw" needs a real source.** A blog post asserting it is weak evidence for the claim the entire product's safety rests on. Prefer the official docs or the protocol's own description. If the best available evidence is weak, say that explicitly — it changes how much we should promise users.
- **Do not confuse agent wallets with sub-accounts or vaults.** Hyperliquid has all three and they have different permissions.
- You have **no credentials**. Read-only `/info` requests need no authentication, so you *may* make real read-only requests to `https://api.hyperliquid.xyz/info` to confirm response shapes — and doing so is much stronger evidence than reading docs. If you do, quote the actual response.
- Do not invent an endpoint that "should" exist. If you cannot find it, that is the finding.
