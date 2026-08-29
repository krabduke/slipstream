/**
 * drizzle-kit config for `pnpm db:generate` / `pnpm db:migrate`.
 *
 * The root scripts pass `--config packages/db/drizzle.config.ts` and run from
 * the repo root, and drizzle-kit resolves `schema` and `out` against the
 * process CWD rather than against this file — so both paths are written
 * relative to the repo root deliberately. Running drizzle-kit from inside
 * `packages/db` will not find the schema; use the root scripts.
 */
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/migrations",
  /**
   * `generate` never connects; only `migrate`, `push` and `studio` do. The
   * empty-string fallback keeps codegen working on a machine with no database
   * configured instead of failing config validation before it starts.
   */
  dbCredentials: { url: process.env["DATABASE_URL"] ?? "" },
  strict: true,
  verbose: true,
})
