/**
 * Static-import twin of `createDb` for bundled deployables (the engine).
 *
 * `client.ts` resolves the `pg` driver lazily through `createRequire` so that
 * typecheck- and test-only consumers never need a driver. A bundler cannot see
 * through that call, so a bundle built from it would ship without a driver and
 * fail at boot. This module imports the driver statically instead; only code
 * that is bundled for deployment should import it.
 */
import { drizzle } from "drizzle-orm/node-postgres"

import type { Db } from "./client.js"
import * as schema from "./schema.js"
import { pgOptions } from "./tls.js"

export const createNodeDb = (url: string, opts: { max?: number } = {}): Db =>
  drizzle({ connection: { ...pgOptions(url), max: opts.max ?? 5 }, schema }) as unknown as Db
