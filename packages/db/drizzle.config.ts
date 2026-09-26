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
import { pgOptions } from "./src/tls"

/** Supabase needs its pinned CA (see src/tls.ts); drizzle-kit takes the same
 *  host/port/user fields plus an `ssl` object. */
function dbCredentials(url: string) {
  if (!url) return { url }
  const o = pgOptions(url)
  if (!o.ssl) return { url }
  const u = new URL(o.connectionString)
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1) || "postgres",
    ssl: o.ssl,
  }
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/migrations",
  /**
   * `generate` never connects; only `migrate`, `push` and `studio` do. The
   * empty-string fallback keeps codegen working on a machine with no database
   * configured instead of failing config validation before it starts.
   */
  dbCredentials: dbCredentials(process.env["DATABASE_URL"] ?? ""),
  strict: true,
  verbose: true,
})
