# Slipstream

**A copy-trading and manual-trading terminal for Hyperliquid and Polymarket that cannot steal your money — and the code to prove it.**

Follow any wallet on either venue, mirror it with real risk controls, and trade manually from the same screen. MIT licensed, zero fees, no token, no premium tier.

> **Status: planning. No application code exists yet.** Start with [PLAN.md](PLAN.md).

## Why this exists

Every open-source copy-trading bot in this space asks for a private key that can drain your account. Both Hyperliquid and Polymarket provide delegated signers that can *trade* but provably cannot *withdraw* — and essentially none of the existing tools use them.

Slipstream refuses to store anything else. Delegation is verified on-chain before a key is ever written to disk. A full database breach costs users bad trades, never funds.

## What makes it different

- **Only un-withdrawable keys.** Verified, not promised. [docs/04](docs/04-security-and-custody.md)
- **Mirrors position *state*, not trade *events*.** Self-healing and crash-safe; a missed WebSocket message is corrected on the next tick instead of desyncing forever. [docs/03 §2](docs/03-copy-engine.md)
- **Entries are gated, exits never are.** Enforced by the type system, not by convention. A risk gate that can block an exit is a trap, not a safeguard. [docs/03 §5](docs/03-copy-engine.md)
- **Skips are a feature.** Copy trading is structurally late. When the price has already run past the leader's fill, Slipstream declines and tells you the number. Every other tool hides this. [docs/03 §7](docs/03-copy-engine.md)
- **Both venues, one risk engine.** Perps and prediction markets, capability-driven rather than special-cased. [docs/02](docs/02-venues-and-data.md)
- **Hosted and genuinely self-hostable.** No paid API dependency, no proprietary storage, `docker compose up`. [docs/01 §4](docs/01-architecture.md)

## Documents

| Doc | Covers |
|---|---|
| [PLAN.md](PLAN.md) | headline decisions, system diagram, open questions |
| [01-architecture](docs/01-architecture.md) | three-plane topology, why the engine can't live on Vercel, stack |
| [02-venues-and-data](docs/02-venues-and-data.md) | the adapter seam, Hyperliquid vs Polymarket, rate limits, money math |
| [03-copy-engine](docs/03-copy-engine.md) | target-state reconciliation, sizing, gates, the decision ledger |
| [04-security-and-custody](docs/04-security-and-custody.md) | the un-withdrawable key rule, envelope encryption, threat model |
| [05-frontend](docs/05-frontend.md) | screens, states, the trust surface |
| [06-roadmap](docs/06-roadmap.md) | six phases with demoable exit criteria, risk register |
| [07-prior-art](docs/07-prior-art.md) | what exists, what it gets wrong, sources |
| [08-build-fleet](docs/08-build-fleet.md) | the ~20-agent build structure |

## Honest warnings

Copy trading loses money for most people who try it. The leader's own trade is part of why the price moved, so a follower is definitionally late, and on thin markets that gap can exceed the entire edge. Slipstream is built to be honest about this rather than to hide it — but no amount of engineering makes a bad leader worth following.

Nothing here is financial advice. Slipstream ranks nobody, recommends nobody, and endorses nobody.

## License

MIT. See [LICENSE](LICENSE).
