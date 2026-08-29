/**
 * The security audit log.
 *
 * APPEND-ONLY, like `decisions`: inserts and reads only, no update or delete
 * helper. `audit_log.user_id` is nullable in the schema solely so entries
 * survive `ON DELETE SET NULL` when an account is removed — it is not an
 * invitation to write unattributed entries, so this helper requires a `userId`
 * like every other.
 */
import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm"

import type { UserId } from "@slipstream/shared"

import type { Db } from "../client.js"
import { auditLog } from "../schema.js"

import {
  pageLimit,
  pageOffset,
  requireRow,
  type PageOptions,
  type TimeRange,
} from "./types.js"

export type AuditLogRow = typeof auditLog.$inferSelect

export interface NewAuditEntry {
  /** e.g. "key.rotated", "risk.limit_raised", "subscription.went_live". */
  readonly action: string
  readonly ip: string | null
  readonly detail: Readonly<Record<string, string>>
  /** Defaults to the database clock. */
  readonly ts?: Date
}

export const insertAuditEntry = async (
  userId: UserId,
  db: Db,
  input: NewAuditEntry,
): Promise<AuditLogRow> => {
  const [row] = await db
    .insert(auditLog)
    .values({
      userId,
      action: input.action,
      ip: input.ip,
      detail: input.detail,
      ...(input.ts === undefined ? {} : { ts: input.ts }),
    })
    .returning()
  return requireRow(row, "audit_log insert")
}

/** Newest first; uses `audit_log_user_ts_idx`. */
export const listAuditLog = async (
  userId: UserId,
  db: Db,
  options: PageOptions & TimeRange & { readonly action?: string } = {},
): Promise<AuditLogRow[]> => {
  const predicates: SQL[] = [eq(auditLog.userId, userId)]
  if (options.since !== undefined) predicates.push(gte(auditLog.ts, options.since))
  if (options.until !== undefined) predicates.push(lte(auditLog.ts, options.until))
  if (options.action !== undefined) predicates.push(eq(auditLog.action, options.action))

  return db
    .select()
    .from(auditLog)
    .where(and(...predicates))
    .orderBy(desc(auditLog.ts))
    .limit(pageLimit(options.limit))
    .offset(pageOffset(options.offset))
}
