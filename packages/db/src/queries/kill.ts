/**
 * Kill switches, from the user's side (docs/04 §6). userId-first.
 *
 *  - subscription scope: pause one follow. Entries stop; EXITS STILL RUN, so a
 *    paused follow is never trapped in a position its leader has left. With
 *    `flatten`, the engine also closes that follow's positions and then marks
 *    the follow stopped.
 *  - user scope: the panic button. Stops all entries for the user; with
 *    `flatten`, closes every position.
 *
 * A kill switch never blocks an exit — it only ever causes them.
 */
import { and, eq } from "drizzle-orm"

import type { SubscriptionId, UserId } from "@slipstream/shared"

import type { Db } from "../client.js"
import { killSwitches, subscriptions } from "../schema.js"
import { TenantScopeError } from "./errors.js"

async function upsertKill(db: Db, scope: string, scopeId: string, active: boolean, flatten: boolean, setBy: string) {
  await db
    .insert(killSwitches)
    .values({ scope, scopeId, active, flatten, setBy })
    .onConflictDoUpdate({
      target: [killSwitches.scope, killSwitches.scopeId],
      set: { active, flatten, setBy, setAt: new Date() },
    })
}

export async function setSubscriptionKill(
  userId: UserId,
  db: Db,
  subscriptionId: SubscriptionId,
  o: { active: boolean; flatten: boolean },
) {
  const [owned] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
    .limit(1)
  if (!owned) throw new TenantScopeError("subscriptions", subscriptionId, userId)
  await upsertKill(db, "subscription", subscriptionId, o.active, o.flatten, `user:${userId}`)
}

export async function setUserKill(userId: UserId, db: Db, o: { active: boolean; flatten: boolean }) {
  await upsertKill(db, "user", userId, o.active, o.flatten, `user:${userId}`)
}

/** Which of this user's follows are paused, and whether the panic switch is on. */
export async function getKillState(userId: UserId, db: Db, subscriptionIds: readonly string[]) {
  const rows = await db
    .select({ scope: killSwitches.scope, scopeId: killSwitches.scopeId, active: killSwitches.active, flatten: killSwitches.flatten })
    .from(killSwitches)
    .where(eq(killSwitches.active, true))
  const mine = new Set(subscriptionIds)
  return {
    panic: rows.some((r) => r.scope === "user" && r.scopeId === userId),
    panicFlatten: rows.some((r) => r.scope === "user" && r.scopeId === userId && r.flatten),
    paused: new Set(rows.filter((r) => r.scope === "subscription" && r.scopeId && mine.has(r.scopeId)).map((r) => r.scopeId!)),
    stopping: new Set(rows.filter((r) => r.scope === "subscription" && r.flatten && r.scopeId && mine.has(r.scopeId)).map((r) => r.scopeId!)),
  }
}
