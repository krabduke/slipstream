/** W15 — sizing modes. Design: docs/03 §3.
 *  equity_ratio MUST fail closed when leader equity is unavailable. */
import { notImplemented } from "@slipstream/shared/notimpl.js"
import type { Decimal, SizingMode } from "@slipstream/shared"

export const sizeFor = (
  _leaderSize: Decimal,
  _sizing: SizingMode,
  _leaderEquity: Decimal | null,
  _followerEquity: Decimal | null,
): Decimal | null => notImplemented("W15", "sizeFor")
