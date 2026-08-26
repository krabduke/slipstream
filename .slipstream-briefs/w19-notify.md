# W19 — Notifications

## Decision (already made — implement, do not revisit)

Implement `packages/notify`: one `Notifier` interface with three adapters — Telegram, Discord (webhook), and email (SMTP). Configuration is per user, stored in the DB; delivery is fire-and-forget from the engine's perspective.

```ts
interface Notifier {
  readonly channel: "telegram" | "discord" | "email"
  send(to: string, event: NotifyEvent): Promise<void>
}
```

Events worth sending, and no others: a copy executed, an exit executed, a kill switch fired, a liquidation-risk warning, a daily summary. **Routine skips are not notified** — they are the normal case and would train users to ignore the channel. The daily summary is where skip counts belong.

**A notification failure must never block or fail a trade.** Catch, log, move on. This package sits at the edge of the system and has no authority over anything.

## Files you own
```
packages/notify/**
```

## Out of scope — do not edit
```
apps/engine/**     W16 — it calls you
packages/db/**     W2
any package.json
```

## Read first
`docs/05-frontend.md` §3 (Settings), `docs/03-copy-engine.md` §7 (what a decision looks like).

## Definition of done
```bash
pnpm typecheck && pnpm test
```
Plus tests proving: all three adapters satisfy one interface; **a throwing adapter does not propagate** — `send` rejects internally and the caller's flow is unaffected; message formatting includes the actual numbers from the decision.

## Known traps
- **Never block a trade on a notification.** If you find yourself `await`ing delivery in a path that leads to an order, that is the bug.
- **Do not notify on every skip.** A channel that fires forty times a day gets muted, and then the one message that mattered is missed too.
- **Never include key material, session tokens, or full addresses** in a message body. Truncate addresses.
- Rate-limit per user per channel. A misconfigured leader producing a burst must not produce a burst of notifications.
- Do not retry indefinitely. Two attempts, then drop and log.
