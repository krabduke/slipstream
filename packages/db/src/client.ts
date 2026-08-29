/** W2 — Drizzle client. Every query helper takes an explicit userId; there is
 *  no unscoped helper to reach for. See docs/04 §5. */
import { createRequire } from "node:module"

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"

import * as schema from "./schema.js"

/**
 * A schema-aware Postgres handle.
 *
 * Typed as the driver-agnostic `PgDatabase` rather than as node-postgres'
 * `NodePgDatabase` on purpose: query helpers should accept any Drizzle
 * Postgres session, so the tests can drive them through a driverless session
 * and assert the SQL that comes out. Anything narrower would force the suite
 * to open a socket to prove that a `where user_id = $1` is present.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

/** Shape of the `drizzle-orm/node-postgres` entrypoint, loaded lazily below. */
type NodePostgresModule = typeof import("drizzle-orm/node-postgres")

const require_ = createRequire(import.meta.url)

/**
 * Open a pooled connection.
 *
 * The `pg` driver is resolved at call time, not at module load.
 * `drizzle-orm/node-postgres` imports `pg` at its top level, so a static
 * import here would make `import "@slipstream/db"` throw for every consumer —
 * including typecheck-only and unit-test consumers that never touch a
 * database. Loading it inside `createDb` keeps the package importable and
 * moves the failure to the one call that genuinely needs a driver.
 *
 * Drizzle's `is()` checks key off `Symbol.for("drizzle:entityKind")`, so the
 * schema built by this module and the driver loaded here interoperate even
 * when they resolve to different module instances.
 *
 * @param url a `postgres://` connection string
 */
export const createDb = (url: string): Db => {
  const { drizzle } = require_("drizzle-orm/node-postgres") as NodePostgresModule
  return drizzle(url, { schema })
}
