/** W2 — Drizzle client. Every query helper takes an explicit userId; there is
 *  no unscoped helper to reach for. See docs/04 §5. */
import { notImplemented } from "@slipstream/shared/notimpl.js"

export type Db = { readonly __db: unique symbol }

export const createDb = (_url: string): Db => notImplemented("W2", "createDb")
