/**
 * The engine invariants the data layer is responsible for keeping true, each
 * asserted against the SQL a helper actually emits.
 */
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import * as auditLogQ from "../queries/audit-log.js"
import * as decisionsQ from "../queries/decisions.js"
import * as fillsQ from "../queries/fills.js"
import * as leadersQ from "../queries/leaders.js"
import * as orderIntentsQ from "../queries/order-intents.js"
import * as positionsQ from "../queries/positions.js"
import * as subscriptionsQ from "../queries/subscriptions.js"
import * as venueAccountsQ from "../queries/venue-accounts.js"
import { DEFAULT_LIMIT, MAX_LIMIT, pageLimit, pageOffset } from "../queries/types.js"

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
} from "./harness.js"


/**
 * Opus review fix: these assertions were checking the WHOLE statement, but
 * Drizzle names every column in its `returning` / `select` list, so
 * "the SQL does not mention is_paper" fails even when the query never writes
 * it. The intent was always about the mutating clause and the filter, so the
 * assertions are scoped to those. The positive assertions were already right
 * and are unchanged.
 */
const writeClause = (sql: string): string => {
  const insert = /insert into\s+"[^"]+"\s*\(([^)]*)\)/i.exec(sql)
  if (insert) return insert[1] ?? ""
  const update = /\bset\b([\s\S]*?)(?:\bwhere\b|\breturning\b|$)/i.exec(sql)
  return update?.[1] ?? ""
}

/** The value an INSERT supplies for a named column: a bound `$n`, or `default`. */
const valueFor = (sql: string, column: string): string | undefined => {
  const insert = /insert into\s+"[^"]+"\s*\(([^)]*)\)\s*values\s*\(([^)]*)\)/i.exec(sql)
  if (!insert) return undefined
  const columns = (insert[1] ?? "").split(",").map((c) => c.trim().replace(/"/g, ""))
  const values = (insert[2] ?? "").split(",").map((v) => v.trim())
  const at = columns.indexOf(column)
  return at === -1 ? undefined : values[at]
}

const whereClause = (sql: string): string => {
  const where = /\bwhere\b([\s\S]*?)(?:\breturning\b|\border by\b|\blimit\b|$)/i.exec(sql)
  return where?.[1] ?? ""
}

const PRICE = "64769.500000000000000000"
const SIZE = "0.001000000000000000"
const FEE = "0.000123000000000000"

describe("exactly-once is a database constraint, not application care", () => {
  it("insertFills conflicts on the unique venue_fill_id and does nothing", async () => {
    const calls = await capture((db) =>
      fillsQ.insertFills(USER_ID, db, [
        {
          orderIntentId: INTENT_ID,
          venueFillId: VENUE_FILL_ID,
          marketId: MARKET_ID,
          side: "buy",
          price: PRICE,
          size: SIZE,
          fee: FEE,
          ts: new Date(),
        },
      ]),
    )
    expect(firstQuery(calls).sql).toMatch(/on conflict \("venue_fill_id"\) do nothing/)
    expect(firstQuery(calls).sql).toMatch(/returning/)
  })

  it("insertLeaderFills conflicts on the unique venue_fill_id and does nothing", async () => {
    const calls = await capture((db) =>
      leadersQ.insertLeaderFills(db, [
        {
          leaderId: LEADER_ID,
          venueMarketId: "BTC",
          side: "buy",
          price: PRICE,
          size: SIZE,
          fee: FEE,
          closedPnl: null,
          ts: new Date(),
          venueFillId: VENUE_FILL_ID,
        },
      ]),
    )
    expect(firstQuery(calls).sql).toMatch(/on conflict \("venue_fill_id"\) do nothing/)
  })

  it("a replayed snapshot sends nothing at all when the batch is empty", async () => {
    const emptyFollower = await capture((db) => fillsQ.insertFills(USER_ID, db, []))
    const emptyLeader = await capture((db) => leadersQ.insertLeaderFills(db, []))
    expect(emptyFollower).toEqual([])
    expect(emptyLeader).toEqual([])
  })

  it("insertFills returns only what it inserted", async () => {
    // Two fills sent, the driver reports one row back: the other was a replay.
    const { db, calls } = (await import("./harness.js")).makeRecordingDb([
      [
        [
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          INTENT_ID,
          USER_ID,
          VENUE_FILL_ID,
          MARKET_ID,
          "buy",
          PRICE,
          SIZE,
          FEE,
          "2026-01-01T00:00:00.000Z",
        ],
      ],
    ])
    const inserted = await fillsQ.insertFills(USER_ID, db, [
      {
        orderIntentId: INTENT_ID,
        venueFillId: VENUE_FILL_ID,
        marketId: MARKET_ID,
        side: "buy",
        price: PRICE,
        size: SIZE,
        fee: FEE,
        ts: new Date(),
      },
      {
        orderIntentId: INTENT_ID,
        venueFillId: "fill-2" as typeof VENUE_FILL_ID,
        marketId: MARKET_ID,
        side: "buy",
        price: PRICE,
        size: SIZE,
        fee: FEE,
        ts: new Date(),
      },
    ])
    expect(calls).toHaveLength(1)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]?.venueFillId).toBe(VENUE_FILL_ID)
  })
})

describe("a crash between decided and placed is safe to retry", () => {
  it("insertOrderIntent conflicts on the unique idempotency_key and does nothing", async () => {
    const calls = await capture((db) =>
      orderIntentsQ.insertOrderIntent(USER_ID, db, {
        subscriptionId: SUBSCRIPTION_ID,
        venue: "hyperliquid",
        marketId: MARKET_ID,
        side: "buy",
        size: SIZE,
        limitPrice: PRICE,
        kind: "limit",
        intentKind: "trade",
        exitReason: null,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    )
    expect(firstQuery(calls).sql).toMatch(/on conflict \("idempotency_key"\) do nothing/)
  })

  it("a conflict re-reads the existing intent, scoped to the same user", async () => {
    const calls = await capture((db) =>
      orderIntentsQ.insertOrderIntent(USER_ID, db, {
        subscriptionId: null,
        venue: "hyperliquid",
        marketId: MARKET_ID,
        side: "buy",
        size: SIZE,
        limitPrice: null,
        kind: "market",
        intentKind: "trade",
        exitReason: null,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    )
    expect(calls).toHaveLength(2)
    expect(calls[1]?.sql).toMatch(/"order_intents"\."idempotency_key" = \$/)
    expect(calls[1]?.sql).toMatch(/"order_intents"\."user_id" = \$/)
    expect(calls[1]?.params).toContain(USER_ID)
  })

  it("a key held by another user is an error, never a cross-tenant read", async () => {
    const { db } = (await import("./harness.js")).makeRecordingDb([[], []])
    await expect(
      orderIntentsQ.insertOrderIntent(USER_ID, db, {
        subscriptionId: null,
        venue: "hyperliquid",
        marketId: MARKET_ID,
        side: "buy",
        size: SIZE,
        limitPrice: null,
        kind: "market",
        intentKind: "trade",
        exitReason: null,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).rejects.toThrow(/not accessible/)
  })
})

describe("money crosses this boundary as a string", () => {
  const moneyParams = (params: readonly unknown[]): unknown[] =>
    params.filter((p) => p === PRICE || p === SIZE || p === FEE)

  it("fill prices, sizes and fees are bound as strings", async () => {
    const calls = await capture((db) =>
      fillsQ.insertFills(USER_ID, db, [
        {
          orderIntentId: null,
          venueFillId: VENUE_FILL_ID,
          marketId: MARKET_ID,
          side: "buy",
          price: PRICE,
          size: SIZE,
          fee: FEE,
          ts: new Date(),
        },
      ]),
    )
    const bound = moneyParams(firstQuery(calls).params)
    expect(bound).toHaveLength(3)
    for (const value of bound) expect(typeof value).toBe("string")
    expect(firstQuery(calls).params).not.toContainEqual(expect.any(Number))
  })

  it("position sizes and prices are bound as strings", async () => {
    const calls = await capture(
      (db) =>
        positionsQ.upsertPosition(USER_ID, db, VENUE_ACCOUNT_ID, {
          marketId: MARKET_ID,
          side: "buy",
          size: SIZE,
          entryPrice: PRICE,
          unrealizedPnl: FEE,
        }),
      [[ownedVenueAccountRow]],
    )
    const write = calls[1]
    expect(write).toBeDefined()
    for (const value of moneyParams(write?.params ?? [])) {
      expect(typeof value).toBe("string")
    }
  })

  it("a leader fill price is bound as a string", async () => {
    const calls = await capture((db) =>
      leadersQ.insertLeaderFills(db, [
        {
          leaderId: LEADER_ID,
          venueMarketId: "BTC",
          side: "sell",
          price: PRICE,
          size: SIZE,
          fee: FEE,
          closedPnl: null,
          ts: new Date(),
          venueFillId: VENUE_FILL_ID,
        },
      ]),
    )
    for (const value of moneyParams(firstQuery(calls).params)) {
      expect(typeof value).toBe("string")
    }
  })
})

describe("subscriptions default to paper and stay there", () => {
  it("insertSubscription never writes is_paper, so the column default applies", async () => {
    const calls = await capture((db) =>
      subscriptionsQ.insertSubscription(USER_ID, db, {
        leaderId: LEADER_ID,
        venueAccountId: VENUE_ACCOUNT_ID,
        sizingMode: "fixed_notional",
        sizingParam: SIZE,
        marketFilter: {},
      }),
    )
    // Drizzle names EVERY column in an insert and passes `default` for the
    // ones you did not set — so "is_paper is absent from the SQL" is the wrong
    // question. The real invariant is that its value is `default`, i.e. the
    // column default (true = paper) applies and nothing bound a value to it.
    expect(valueFor(firstQuery(calls).sql, "is_paper")).toBe("default")
  })

  it("setSubscriptionStatus touches status only", async () => {
    const calls = await capture((db) =>
      subscriptionsQ.setSubscriptionStatus(USER_ID, db, SUBSCRIPTION_ID, "paused"),
    )
    expect(writeClause(firstQuery(calls).sql)).not.toMatch(/is_paper/)
    expect(firstQuery(calls).sql).toMatch(/set "status" = \$/)
  })

  it("updateSubscription cannot reach is_paper or status", async () => {
    const calls = await capture((db) =>
      subscriptionsQ.updateSubscription(USER_ID, db, SUBSCRIPTION_ID, {
        sizingMode: "percent_equity",
        sizingParam: SIZE,
        marketFilter: { venues: ["hyperliquid"] },
      }),
    )
    expect(writeClause(firstQuery(calls).sql)).not.toMatch(/is_paper/)
    expect(writeClause(firstQuery(calls).sql)).not.toMatch(/"status"/)
  })

  it("setSubscriptionPaperMode is the only writer of is_paper", async () => {
    const calls = await capture((db) =>
      subscriptionsQ.setSubscriptionPaperMode(USER_ID, db, SUBSCRIPTION_ID, false),
    )
    expect(firstQuery(calls).sql).toMatch(/set "is_paper" = \$/)

    const source = readFileSync(
      new URL("../queries/subscriptions.ts", import.meta.url),
      "utf8",
    )
    const writers = source.match(/isPaper/g) ?? []
    // Two mentions in code — the parameter and the `set` — plus prose.
    expect(source.match(/set\(\{ isPaper \}\)/g) ?? []).toHaveLength(1)
    expect(writers.length).toBeGreaterThan(0)
  })
})

describe("the three addresses are never conflated", () => {
  it("findVenueAccountByOwner matches owner_address only", async () => {
    const calls = await capture((db) =>
      venueAccountsQ.findVenueAccountByOwner(USER_ID, db, "polymarket", "0xOWNER"),
    )
    const { sql } = firstQuery(calls)
    expect(sql).toMatch(/"owner_address" = \$/)
    expect(whereClause(sql)).not.toMatch(/signer_address/)
    expect(whereClause(sql)).not.toMatch(/funder_address/)
  })

  it("findVenueAccountByFunder matches funder_address only", async () => {
    const calls = await capture((db) =>
      venueAccountsQ.findVenueAccountByFunder(USER_ID, db, "polymarket", "0xFUNDER"),
    )
    const { sql } = firstQuery(calls)
    expect(sql).toMatch(/"funder_address" = \$/)
    expect(whereClause(sql)).not.toMatch(/owner_address/)
    expect(whereClause(sql)).not.toMatch(/signer_address/)
  })

  it("setVenueAccountSigner cannot rewrite the withdrawal authority", async () => {
    const calls = await capture((db) =>
      venueAccountsQ.setVenueAccountSigner(USER_ID, db, VENUE_ACCOUNT_ID, "0xNEW"),
    )
    const { sql } = firstQuery(calls)
    expect(sql).toMatch(/set "signer_address" = \$/)
    expect(writeClause(sql)).not.toMatch(/owner_address/)
    expect(writeClause(sql)).not.toMatch(/funder_address/)
  })
})

describe("addresses are normalised on write, never by the caller", () => {
  it("insertVenueAccount lowercases all three", async () => {
    const calls = await capture((db) =>
      venueAccountsQ.insertVenueAccount(USER_ID, db, {
        venue: "polymarket",
        ownerAddress: "0xAbCdEf",
        signerAddress: "0xFEDCBA",
        funderAddress: "0xFuNdEr",
        delegationMethod: "eip1271",
        verifiedAt: new Date(),
      }),
    )
    const { params } = firstQuery(calls)
    expect(params).toContain("0xabcdef")
    expect(params).toContain("0xfedcba")
    expect(params).toContain("0xfunder")
    for (const value of params) {
      if (typeof value === "string" && value.startsWith("0x")) {
        expect(value).toBe(value.toLowerCase())
      }
    }
  })

  it("lookups lowercase the address they are given", async () => {
    const calls = await capture((db) =>
      venueAccountsQ.findVenueAccountByOwner(USER_ID, db, "polymarket", "0xMIXEDcase"),
    )
    expect(firstQuery(calls).params).toContain("0xmixedcase")
  })

  it("upsertLeader and findLeader lowercase the leader address", async () => {
    const upsert = await capture((db) =>
      leadersQ.upsertLeader(db, { venue: "hyperliquid", address: "0xLEADER" }),
    )
    expect(firstQuery(upsert).params).toContain("0xleader")

    const find = await capture((db) => leadersQ.findLeader(db, "hyperliquid", "0xLEADER"))
    expect(firstQuery(find).params).toContain("0xleader")
  })

  it("insertDecision lowercases the leader address it records", async () => {
    const calls = await capture((db) =>
      decisionsQ.insertDecision(USER_ID, db, {
        subscriptionId: null,
        venue: "hyperliquid",
        marketId: MARKET_ID,
        verdict: "copied",
        reasonCode: null,
        detail: {},
        leaderAddress: "0xLEADER",
        leaderFillPrice: PRICE,
      }),
    )
    expect(firstQuery(calls).params).toContain("0xleader")
  })
})

describe("decisions and audit_log are append-only", () => {
  const mutating = /^(update|delete|remove|drop|purge|set|patch|edit|clear)/i

  it("the decisions module exports no mutating helper", () => {
    for (const name of Object.keys(decisionsQ)) {
      expect(name).not.toMatch(mutating)
    }
  })

  it("the audit_log module exports no mutating helper", () => {
    for (const name of Object.keys(auditLogQ)) {
      expect(name).not.toMatch(mutating)
    }
  })

  it("neither module's source contains an update or delete statement", () => {
    for (const file of ["decisions", "audit-log"]) {
      const source = readFileSync(new URL(`../queries/${file}.ts`, import.meta.url), "utf8")
      expect(source).not.toMatch(/db\.update\(/)
      expect(source).not.toMatch(/db\.delete\(/)
    }
  })
})

describe("the leaderboard module reaches no user-owned table", () => {
  it("imports only the three tenant-less tables from the schema", () => {
    const source = readFileSync(new URL("../queries/leaders.ts", import.meta.url), "utf8")
    const match = /import\s*\{([^}]*)\}\s*from\s*"\.\.\/schema\.js"/.exec(source)
    expect(match).not.toBeNull()
    const imported = (match?.[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .sort()
    expect(imported).toEqual(["leaderFills", "leaderStats", "leaders"])
  })
})

describe("list helpers are bounded", () => {
  it("clamps page sizes into [1, MAX_LIMIT]", () => {
    expect(pageLimit(undefined)).toBe(DEFAULT_LIMIT)
    expect(pageLimit(Number.NaN)).toBe(DEFAULT_LIMIT)
    expect(pageLimit(0)).toBe(1)
    expect(pageLimit(-5)).toBe(1)
    expect(pageLimit(10.7)).toBe(10)
    expect(pageLimit(MAX_LIMIT * 10)).toBe(MAX_LIMIT)
  })

  it("clamps offsets to non-negative integers", () => {
    expect(pageOffset(undefined)).toBe(0)
    expect(pageOffset(-1)).toBe(0)
    expect(pageOffset(12.9)).toBe(12)
  })

  it("applies a limit even when the caller asks for none", async () => {
    const calls = await capture((db) => fillsQ.listFills(USER_ID, db))
    expect(firstQuery(calls).sql).toMatch(/limit \$/)
    expect(firstQuery(calls).params).toContain(DEFAULT_LIMIT)
  })

  it("caps a caller who asks for more than MAX_LIMIT", async () => {
    const calls = await capture((db) => decisionsQ.listDecisions(USER_ID, db, { limit: 1e6 }))
    expect(firstQuery(calls).params).toContain(MAX_LIMIT)
  })
})
