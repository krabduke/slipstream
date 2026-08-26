/** W14 — conservative defaults. A user who wants to be reckless types the
 *  number themselves; that is both a safety and an informed-consent property. */
import { notImplemented } from "@slipstream/shared/notimpl.js"
import type { RiskLimits } from "./types.js"

export const DEFAULT_LIMITS: () => RiskLimits = () => notImplemented("W14", "DEFAULT_LIMITS")
