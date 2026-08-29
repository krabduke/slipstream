import type { UserId } from "@slipstream/shared"

/**
 * A row exists but does not belong to the calling user — or does not exist at
 * all, which is deliberately indistinguishable from the caller's side.
 *
 * Thrown rather than returned. A write that quietly affects zero rows because
 * the tenant check failed is the exact failure this data-access layer exists
 * to prevent; it must be loud.
 */
export class TenantScopeError extends Error {
  override readonly name = "TenantScopeError"

  constructor(
    readonly table: string,
    readonly rowId: string,
    readonly userId: UserId,
  ) {
    super(`${table} ${rowId} is not accessible to user ${userId}`)
  }
}
