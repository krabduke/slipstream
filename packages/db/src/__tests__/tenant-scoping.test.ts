/**
 * The rule this package exists to enforce: a caller cannot reach a user-owned
 * row without naming the user.
 *
 * Two independent checks, because either alone can rot:
 *  1. every exported helper over a user-owned table names `userId` first;
 *  2. the SQL that helper actually emits carries the tenant predicate and
 *     binds that `userId`.
 */
import { describe, expect, it } from "vitest"

import type { Db } from "../client.js"
import * as auditLogQ from "../queries/audit-log.js"
import * as decisionsQ from "../queries/decisions.js"
import * as encryptedKeysQ from "../queries/encrypted-keys.js"
import * as fillsQ from "../queries/fills.js"
import * as leadersQ from "../queries/leaders.js"
import * as orderIntentsQ from "../queries/order-intents.js"
import * as positionsQ from "../queries/positions.js"
import * as riskProfilesQ from "../queries/risk-profiles.js"
import * as subscriptionsQ from "../queries/subscriptions.js"
import * as usersQ from "../queries/users.js"
import * as venueAccountsQ from "../queries/venue-accounts.js"

import {
  capture,
  firstQuery,
  IDEMPOTENCY_KEY,
  INTENT_ID,
  LEADER_ID,
  MARKET_ID,
  ownedVenueAccountRow,
  SUBSCRIPTION_ID,
  USER_ID,
  VENUE_ACCOUNT_ID,
  VENUE_FILL_ID,
  VENUE_ORDER_ID,
  type DriverRow,
} from "./harness.js"

const scopedModules = {
  "users.ts": usersQ,
  "venue-accounts.ts": venueAccountsQ,
  "encrypted-keys.ts": encryptedKeysQ,
  "subscriptions.ts": subscriptionsQ,
  "risk-profiles.ts": riskProfilesQ,
  "order-intents.ts": orderIntentsQ,
  "fills.ts": fillsQ,
  "positions.ts": positionsQ,
  "decisions.ts": decisionsQ,
  "audit-log.ts": auditLogQ,
} satisfies Record<string, Record<string, unknown>>

const firstParameterName = (fn: (...args: never[]) => unknown): string => {
  const source = fn.toString()
  const match = /^(?:async\s*)?\(\s*([A-Za-z_$][\w$]*)/.exec(source)
  return match?.[1] ?? "<unparsed>"
}

const exportedFunctions = (mod: Record<string, unknown>): [string, (...a: never[]) => unknown][] =>
  Object.entries(mod).filter((entry): entry is [string, (...a: never[]) => unknown] =>
    typeof entry[1] === "function",
  )

describe("every helper over a user-owned table names userId first", () => {
  for (const [file, mod] of Object.entries(scopedModules)) {
    const fns = exportedFunctions(mod)

    it(`${file} exports at least one helper`, () => {
      expect(fns.length).toBeGreaterThan(0)
    })

    for (const [name, fn] of fns) {
      it(`${file}: ${name}(userId, db, ...)`, () => {
        expect(firstParameterName(fn)).toBe("userId")
      })
    }
  }
})

describe("the leaderboard tables are tenant-less, not a way around the rule", () => {
  const fns = exportedFunctions(leadersQ)

  it("exports helpers", () => {
    expect(fns.length).toBeGreaterThan(0)
  })

  for (const [name, fn] of fns) {
    it(`leaders.ts: ${name}(db, ...) takes no userId`, () => {
      expect(firstParameterName(fn)).toBe("db")
    })
  }

  it("emits no SQL naming user_id", async () => {
    const statements = [
      ...(await capture((db) => leadersQ.listLeaders(db))),
      ...(await capture((db) => leadersQ.getLeader(db, LEADER_ID))),
      ...(await capture((db) => leadersQ.findLeader(db, "hyperliquid", "0xABC"))),
      ...(await capture((db) => leadersQ.listLeaderFills(db, LEADER_ID))),
      ...(await capture((db) => leadersQ.listLeaderStats(db, LEADER_ID))),
      ...(await capture((db) => leadersQ.getLeaderStats(db, LEADER_ID, "7d"))),
      ...(await capture((db) => leadersQ.setLeaderLastEventAt(db, LEADER_ID, new Date()))),
      ...(await capture((db) =>
        leadersQ.upsertLeader(db, { venue: "hyperliquid", address: "0xABC" }),
      )),
    ]
    expect(statements.length).toBeGreaterThan(0)
    for (const statement of statements) {
      expect(statement.sql).not.toMatch(/user_id/)
    }
  })
})

interface ScopeCase {
  readonly name: string
  readonly run: (db: Db) => Promise<unknown>
  /** Must match the FIRST statement the helper sends. */
  readonly scope: RegExp
  readonly responses?: readonly (readonly DriverRow[])[]
}

const money = "1.500000000000000000"

const cases: readonly ScopeCase[] = [
  // users — the tenant column is the primary key
  { name: "getUser", run: (db) => usersQ.getUser(USER_ID, db), scope: /"users"\."id" = \$/ },
  {
    name: "touchUserLastSeen",
    run: (db) => usersQ.touchUserLastSeen(USER_ID, db, new Date()),
    scope: /"users"\."id" = \$/,
  },

  // venue_accounts
  {
    name: "listVenueAccounts",
    run: (db) => venueAccountsQ.listVenueAccounts(USER_ID, db),
    scope: /"venue_accounts"\."user_id" = \$/,
  },
  {
    name: "getVenueAccount",
    run: (db) => venueAccountsQ.getVenueAccount(USER_ID, db, VENUE_ACCOUNT_ID),
    scope: /"venue_accounts"\."user_id" = \$/,
  },
  {
    name: "requireOwnedVenueAccount",
    run: (db) => venueAccountsQ.requireOwnedVenueAccount(USER_ID, db, VENUE_ACCOUNT_ID),
    scope: /"venue_accounts"\."user_id" = \$/,
  },
  {
    name: "findVenueAccountByOwner",
    run: (db) => venueAccountsQ.findVenueAccountByOwner(USER_ID, db, "hyperliquid", "0xOWNER"),
    scope: /"venue_accounts"\."user_id" = \$/,
  },
  {
    name: "findVenueAccountByFunder",
    run: (db) => venueAccountsQ.findVenueAccountByFunder(USER_ID, db, "hyperliquid", "0xFUNDER"),
    scope: /"venue_accounts"\."user_id" = \$/,
  },
  {
    name: "insertVenueAccount",
    run: (db) =>
      venueAccountsQ.insertVenueAccount(USER_ID, db, {
        venue: "hyperliquid",
        ownerAddress: "0xOWNER",
        signerAddress: "0xSIGNER",
        delegationMethod: "api_wallet",
        verifiedAt: new Date(),
      }),
    scope: /insert into "venue_accounts".*"user_id"/s,
  },
  {
    name: "setVenueAccountStatus",
    run: (db) => venueAccountsQ.setVenueAccountStatus(USER_ID, db, VENUE_ACCOUNT_ID, "revoked"),
    scope: /"venue_accounts"\."user_id" = \$/,
  },
  {
    name: "setVenueAccountSigner",
    run: (db) => venueAccountsQ.setVenueAccountSigner(USER_ID, db, VENUE_ACCOUNT_ID, "0xNEW"),
    scope: /"venue_accounts"\."user_id" = \$/,
  },

  // encrypted_keys — no user_id column; joins or guards through venue_accounts
  {
    name: "getEncryptedKey",
    run: (db) => encryptedKeysQ.getEncryptedKey(USER_ID, db, VENUE_ACCOUNT_ID),
    scope: /"venue_accounts"\."user_id" = \$/,
  },
  {
    name: "upsertEncryptedKey",
    run: (db) =>
      encryptedKeysQ.upsertEncryptedKey(USER_ID, db, VENUE_ACCOUNT_ID, {
        ciphertext: "c",
        iv: "i",
        tag: "t",
        wrappedDek: "w",
        kmsKeyId: "k",
      }),
    scope: /"venue_accounts"\."user_id" = \$/,
  },
  {
    name: "deleteEncryptedKey",
    run: (db) => encryptedKeysQ.deleteEncryptedKey(USER_ID, db, VENUE_ACCOUNT_ID),
    scope: /"venue_accounts"\."user_id" = \$/,
  },

  // subscriptions
  {
    name: "listSubscriptions",
    run: (db) => subscriptionsQ.listSubscriptions(USER_ID, db),
    scope: /"subscriptions"\."user_id" = \$/,
  },
  {
    name: "getSubscription",
    run: (db) => subscriptionsQ.getSubscription(USER_ID, db, SUBSCRIPTION_ID),
    scope: /"subscriptions"\."user_id" = \$/,
  },
  {
    name: "insertSubscription",
    run: (db) =>
      subscriptionsQ.insertSubscription(USER_ID, db, {
        leaderId: LEADER_ID,
        venueAccountId: VENUE_ACCOUNT_ID,
        sizingMode: "equity_ratio",
        sizingParam: money,
        marketFilter: {},
      }),
    scope: /insert into "subscriptions".*"user_id"/s,
  },
  {
    name: "updateSubscription",
    run: (db) =>
      subscriptionsQ.updateSubscription(USER_ID, db, SUBSCRIPTION_ID, { sizingParam: money }),
    scope: /"subscriptions"\."user_id" = \$/,
  },
  {
    name: "setSubscriptionStatus",
    run: (db) => subscriptionsQ.setSubscriptionStatus(USER_ID, db, SUBSCRIPTION_ID, "paused"),
    scope: /"subscriptions"\."user_id" = \$/,
  },
  {
    name: "setSubscriptionPaperMode",
    run: (db) => subscriptionsQ.setSubscriptionPaperMode(USER_ID, db, SUBSCRIPTION_ID, false),
    scope: /"subscriptions"\."user_id" = \$/,
  },

  // risk_profiles
  {
    name: "getRiskProfile (account default)",
    run: (db) => riskProfilesQ.getRiskProfile(USER_ID, db, null),
    scope: /"risk_profiles"\."user_id" = \$/,
  },
  {
    name: "getEffectiveRiskProfile",
    run: (db) => riskProfilesQ.getEffectiveRiskProfile(USER_ID, db, SUBSCRIPTION_ID),
    scope: /"risk_profiles"\."user_id" = \$/,
  },
  {
    name: "listRiskProfiles",
    run: (db) => riskProfilesQ.listRiskProfiles(USER_ID, db),
    scope: /"risk_profiles"\."user_id" = \$/,
  },
  {
    name: "insertRiskProfile",
    run: (db) =>
      riskProfilesQ.insertRiskProfile(USER_ID, db, null, {
        maxNotionalPerPosition: money,
        maxPositionPctEquity: money,
        maxTotalExposure: money,
        maxLeverage: money,
        maxSlippageBps: 50,
        maxSignalAgeMs: 3000,
        maxBookPct: money,
        dailyLossLimit: money,
      }),
    scope: /insert into "risk_profiles".*"user_id"/s,
  },
  {
    name: "updateRiskProfile",
    run: (db) => riskProfilesQ.updateRiskProfile(USER_ID, db, null, { maxLeverage: money }),
    scope: /"risk_profiles"\."user_id" = \$/,
  },

  // order_intents
  {
    name: "insertOrderIntent",
    run: (db) =>
      orderIntentsQ.insertOrderIntent(USER_ID, db, {
        subscriptionId: SUBSCRIPTION_ID,
        venue: "hyperliquid",
        marketId: MARKET_ID,
        side: "buy",
        size: money,
        limitPrice: null,
        kind: "market",
        intentKind: "trade",
        exitReason: null,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    scope: /insert into "order_intents".*"user_id"/s,
  },
  {
    name: "getOrderIntent",
    run: (db) => orderIntentsQ.getOrderIntent(USER_ID, db, INTENT_ID),
    scope: /"order_intents"\."user_id" = \$/,
  },
  {
    name: "findOrderIntentByIdempotencyKey",
    run: (db) => orderIntentsQ.findOrderIntentByIdempotencyKey(USER_ID, db, IDEMPOTENCY_KEY),
    scope: /"order_intents"\."user_id" = \$/,
  },
  {
    name: "listOrderIntents",
    run: (db) => orderIntentsQ.listOrderIntents(USER_ID, db, { status: "pending" }),
    scope: /"order_intents"\."user_id" = \$/,
  },
  {
    name: "setOrderIntentStatus",
    run: (db) =>
      orderIntentsQ.setOrderIntentStatus(USER_ID, db, INTENT_ID, "placed", {
        venueOrderId: VENUE_ORDER_ID,
      }),
    scope: /"order_intents"\."user_id" = \$/,
  },

  // fills
  {
    name: "insertFills",
    run: (db) =>
      fillsQ.insertFills(USER_ID, db, [
        {
          orderIntentId: INTENT_ID,
          venueFillId: VENUE_FILL_ID,
          marketId: MARKET_ID,
          side: "buy",
          price: money,
          size: money,
          fee: money,
          ts: new Date(),
        },
      ]),
    scope: /insert into "fills".*"user_id"/s,
  },
  {
    name: "listFills",
    run: (db) => fillsQ.listFills(USER_ID, db, { marketId: MARKET_ID }),
    scope: /"fills"\."user_id" = \$/,
  },
  {
    name: "findFillByVenueFillId",
    run: (db) => fillsQ.findFillByVenueFillId(USER_ID, db, VENUE_FILL_ID),
    scope: /"fills"\."user_id" = \$/,
  },
  {
    name: "listFillsForIntent",
    run: (db) => fillsQ.listFillsForIntent(USER_ID, db, INTENT_ID),
    scope: /"fills"\."user_id" = \$/,
  },

  // positions_snapshot — no user_id column
  {
    name: "listPositions",
    run: (db) => positionsQ.listPositions(USER_ID, db),
    scope: /"venue_accounts"\."user_id" = \$/,
  },
  {
    name: "getPosition",
    run: (db) => positionsQ.getPosition(USER_ID, db, VENUE_ACCOUNT_ID, MARKET_ID),
    scope: /"venue_accounts"\."user_id" = \$/,
  },
  {
    name: "upsertPosition",
    run: (db) =>
      positionsQ.upsertPosition(USER_ID, db, VENUE_ACCOUNT_ID, {
        marketId: MARKET_ID,
        side: "buy",
        size: money,
        entryPrice: money,
        unrealizedPnl: money,
      }),
    scope: /"venue_accounts"\."user_id" = \$/,
  },
  {
    name: "deletePosition",
    run: (db) => positionsQ.deletePosition(USER_ID, db, VENUE_ACCOUNT_ID, MARKET_ID),
    scope: /"venue_accounts"\."user_id" = \$/,
  },

  // decisions (append-only)
  {
    name: "insertDecision",
    run: (db) =>
      decisionsQ.insertDecision(USER_ID, db, {
        subscriptionId: SUBSCRIPTION_ID,
        venue: "hyperliquid",
        marketId: MARKET_ID,
        verdict: "skipped",
        reasonCode: "slippage_exceeded",
        detail: { observedBps: "87", limitBps: "50" },
        leaderAddress: "0xLEADER",
        leaderFillPrice: money,
      }),
    scope: /insert into "decisions".*"user_id"/s,
  },
  {
    name: "insertDecisions",
    run: (db) =>
      decisionsQ.insertDecisions(USER_ID, db, [
        {
          subscriptionId: null,
          venue: "polymarket",
          marketId: MARKET_ID,
          verdict: "copied",
          reasonCode: null,
          detail: {},
          leaderAddress: null,
          leaderFillPrice: null,
        },
      ]),
    scope: /insert into "decisions".*"user_id"/s,
  },
  {
    name: "listDecisions",
    run: (db) => decisionsQ.listDecisions(USER_ID, db, { verdict: "skipped" }),
    scope: /"decisions"\."user_id" = \$/,
  },

  // audit_log (append-only)
  {
    name: "insertAuditEntry",
    run: (db) =>
      auditLogQ.insertAuditEntry(USER_ID, db, {
        action: "key.rotated",
        ip: "127.0.0.1",
        detail: {},
      }),
    scope: /insert into "audit_log".*"user_id"/s,
  },
  {
    name: "listAuditLog",
    run: (db) => auditLogQ.listAuditLog(USER_ID, db),
    scope: /"audit_log"\."user_id" = \$/,
  },
]

describe("the emitted SQL is tenant-scoped and binds the caller's userId", () => {
  for (const testCase of cases) {
    it(testCase.name, async () => {
      const calls = await capture(testCase.run, testCase.responses ?? [])
      const first = firstQuery(calls)
      expect(first.sql).toMatch(testCase.scope)
      expect(first.params).toContain(USER_ID)
    })
  }

  it("covers every exported helper over a user-owned table", () => {
    const covered = new Set(cases.map((c) => c.name.replace(/ \(.*\)$/, "")))
    const missing: string[] = []
    for (const mod of Object.values(scopedModules)) {
      for (const [name] of exportedFunctions(mod)) {
        if (!covered.has(name)) missing.push(name)
      }
    }
    expect(missing).toEqual([])
  })
})

describe("helpers that guard on ownership before writing", () => {
  it("upsertEncryptedKey checks venue_accounts first, then writes", async () => {
    const calls = await capture(
      (db) =>
        encryptedKeysQ.upsertEncryptedKey(USER_ID, db, VENUE_ACCOUNT_ID, {
          ciphertext: "c",
          iv: "i",
          tag: "t",
          wrappedDek: "w",
          kmsKeyId: "k",
        }),
      [[ownedVenueAccountRow]],
    )
    expect(calls).toHaveLength(2)
    expect(calls[0]?.sql).toMatch(/"venue_accounts"\."user_id" = \$/)
    expect(calls[1]?.sql).toMatch(/insert into "encrypted_keys"/)
    expect(calls[1]?.sql).toMatch(/on conflict \("venue_account_id"\) do update/)
  })

  it("upsertPosition checks venue_accounts first, then writes", async () => {
    const calls = await capture(
      (db) =>
        positionsQ.upsertPosition(USER_ID, db, VENUE_ACCOUNT_ID, {
          marketId: MARKET_ID,
          side: "buy",
          size: money,
          entryPrice: money,
          unrealizedPnl: money,
        }),
      [[ownedVenueAccountRow]],
    )
    expect(calls).toHaveLength(2)
    expect(calls[0]?.sql).toMatch(/"venue_accounts"\."user_id" = \$/)
    expect(calls[1]?.sql).toMatch(/insert into "positions_snapshot"/)
  })

  it("upsertEncryptedKey never reaches the write when the account is another user's", async () => {
    const { db, calls } = (await import("./harness.js")).makeRecordingDb([])
    await expect(
      encryptedKeysQ.upsertEncryptedKey(USER_ID, db, VENUE_ACCOUNT_ID, {
        ciphertext: "c",
        iv: "i",
        tag: "t",
        wrappedDek: "w",
        kmsKeyId: "k",
      }),
    ).rejects.toThrow(/not accessible/)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toMatch(/select/)
  })

  it("deletePosition scopes itself in a single statement", async () => {
    const calls = await capture((db) =>
      positionsQ.deletePosition(USER_ID, db, VENUE_ACCOUNT_ID, MARKET_ID),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sql).toMatch(/delete from "positions_snapshot"/)
    expect(calls[0]?.sql).toMatch(/"venue_accounts"\."user_id" = \$/)
  })
})
