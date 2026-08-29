/**
 * Risk limits.
 *
 * A row with `subscription_id = NULL` is the user's account-wide default; a
 * row naming a subscription overrides it for that follow.
 *
 * Note on `risk_profiles_scope_idx`: Postgres treats NULLs as distinct in a
 * unique index unless it is declared `NULLS NOT DISTINCT`, and the schema does
 * not declare it so. The index therefore constrains subscription-scoped rows
 * but does *not* stop a second account-wide default from being inserted. That
 * is why there is no blanket `upsertRiskProfile` here — an ON CONFLICT whose
 * target silently never matches for the default row is worse than an explicit
 * insert and update pair.
 */
import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm"

import type { SubscriptionId, UserId } from "@slipstream/shared"

import type { Db } from "../client.js"
import { riskProfiles } from "../schema.js"

import { TenantScopeError } from "./errors.js"
import { requireRow, type MoneyString } from "./types.js"

export type RiskProfileRow = typeof riskProfiles.$inferSelect

/** Every money field is a `numeric(38,18)` string; the two `*_ms`/`*_bps`
 *  fields are genuine integers and are the only numbers here. */
export interface RiskLimits {
  readonly maxNotionalPerPosition: MoneyString
  readonly maxPositionPctEquity: MoneyString
  readonly maxTotalExposure: MoneyString
  readonly maxLeverage: MoneyString
  readonly maxSlippageBps: number
  readonly maxSignalAgeMs: number
  readonly maxBookPct: MoneyString
  readonly dailyLossLimit: MoneyString
}

export type RiskLimitsPatch = Partial<RiskLimits>

/** `subscription_id IS NULL` cannot be expressed with `eq`. */
const scopePredicate = (subscriptionId: SubscriptionId | null): SQL =>
  subscriptionId === null
    ? isNull(riskProfiles.subscriptionId)
    : eq(riskProfiles.subscriptionId, subscriptionId)

/** Fetch exactly the row at this scope. `null` means the account-wide default. */
export const getRiskProfile = async (
  userId: UserId,
  db: Db,
  subscriptionId: SubscriptionId | null,
): Promise<RiskProfileRow | undefined> => {
  const [row] = await db
    .select()
    .from(riskProfiles)
    .where(and(eq(riskProfiles.userId, userId), scopePredicate(subscriptionId)))
    .limit(1)
  return row
}

/**
 * The limits that actually apply to a subscription: its own row if it has
 * one, otherwise the user's account-wide default. This is the read the risk
 * gate wants; `getRiskProfile` is the read the settings screen wants.
 */
export const getEffectiveRiskProfile = async (
  userId: UserId,
  db: Db,
  subscriptionId: SubscriptionId | null,
): Promise<RiskProfileRow | undefined> => {
  const scope =
    subscriptionId === null
      ? isNull(riskProfiles.subscriptionId)
      : or(
          eq(riskProfiles.subscriptionId, subscriptionId),
          isNull(riskProfiles.subscriptionId),
        )
  const [row] = await db
    .select()
    .from(riskProfiles)
    .where(and(eq(riskProfiles.userId, userId), scope))
    // Non-null scope sorts first, so the subscription's own row wins.
    .orderBy(sql`${riskProfiles.subscriptionId} nulls last`)
    .limit(1)
  return row
}

export const listRiskProfiles = async (
  userId: UserId,
  db: Db,
): Promise<RiskProfileRow[]> =>
  db.select().from(riskProfiles).where(eq(riskProfiles.userId, userId))

export const insertRiskProfile = async (
  userId: UserId,
  db: Db,
  subscriptionId: SubscriptionId | null,
  limits: RiskLimits,
): Promise<RiskProfileRow> => {
  const [row] = await db
    .insert(riskProfiles)
    .values({ userId, subscriptionId, ...limits })
    .returning()
  return requireRow(row, "risk_profiles insert")
}

/**
 * Raise or lower limits at one scope.
 *
 * Raising a limit is a step-up action at the call site (docs/04 §5); this
 * layer enforces only that the row belongs to the caller.
 *
 * @throws TenantScopeError if no profile exists at that scope for this user
 */
export const updateRiskProfile = async (
  userId: UserId,
  db: Db,
  subscriptionId: SubscriptionId | null,
  patch: RiskLimitsPatch,
): Promise<RiskProfileRow> => {
  const [row] = await db
    .update(riskProfiles)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(riskProfiles.userId, userId), scopePredicate(subscriptionId)))
    .returning()
  if (row === undefined) {
    throw new TenantScopeError("risk_profiles", subscriptionId ?? "account-default", userId)
  }
  return row
}
