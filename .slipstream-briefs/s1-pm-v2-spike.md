# S1 — Spike: can we place a Polymarket CLOB V2 order?

This is a **research spike**, not an implementation. Its output is an answer, written to a file. It is the single largest technical risk in the whole project (risk register #1, docs/06) and Polymarket write support depends on the verdict.

## FIRST action

Create `docs/spikes/s1-polymarket-v2.md` containing just a title and the four question headings below. Then research and **append findings as you get them**. Never hold findings in your head.

## The question

Polymarket CLOB V2 went live 28 April 2026; V1 signing is dead. We need to know, before anyone writes adapter code, whether a server-side bot can place an order using the **deposit-wallet / POLY_1271 (signature type 3)** flow, where the signer and the funder are different addresses.

There are open issues in Polymarket's own V2 clients reporting that L1 auth binds the API key to the EOA rather than the deposit wallet, which would block exactly our use case.

Answer these four, each with citations:

1. **What does the V2 order struct and signing flow actually require?** Which fields, which EIP-712 domain, which version. Cite the SDK source or the official migration doc.
2. **Does POLY_1271 order placement work today, or is it blocked?** Find the open issues, read them, and report their current state — open, closed, worked around. Do not guess from titles; read the thread.
3. **If blocked, is there a documented workaround?** A different signature type, a different auth sequence, a version that works.
4. **What credentials and on-chain setup would a real end-to-end test need?** Be concrete: which wallet, which approvals, how much USDC minimum.

## Files you own

```
docs/spikes/s1-polymarket-v2.md
```

Create nothing else. Do **not** write adapter code — that is W7/W12's territory and is out of scope for this spike.

## Definition of done

`docs/spikes/s1-polymarket-v2.md` exists and answers all four questions, each claim carrying a citation (a URL, or a `path:line` if you read vendored source). It ends with a one-line **VERDICT**: one of

- `VERDICT: WORKS` — deposit-wallet order placement is viable now
- `VERDICT: WORKS WITH WORKAROUND` — plus what the workaround is
- `VERDICT: BLOCKED` — plus what would have to change

## Known traps

- **Anything dated before May 2026 is wrong about V2 signing.** Check dates on every source. A confident tutorial from March 2026 describes a protocol that no longer exists.
- **`py-clob-client` (v1) and `py-clob-client-v2` are different packages**, as are `@polymarket/clob-client` and `@polymarket/clob-client-v2`. Do not conflate them; a v1 answer to a v2 question is worse than no answer.
- **Signer ≠ funder ≠ owner.** Three addresses. The whole spike is about a flow where they differ, so be precise about which one each source is talking about.
- You have **no credentials and no funded wallet**. You cannot actually place an order. Say so; do not simulate one and report it as evidence. The verdict is allowed to be "cannot be confirmed without credentials" for any sub-question — that is a real finding.
- Do not invent issue numbers or quote text you did not read.
