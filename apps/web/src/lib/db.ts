import "server-only"
import { createNodeDb } from "@slipstream/db/node"
import type { Db } from "@slipstream/db"

/**
 * One pooled connection per server instance, created on first use (never at
 * import time, so `next build` works without a database). Vercel's Supabase
 * integration provides POSTGRES_URL (pooled); DATABASE_URL wins if set.
 */
let db: Db | null = null
export function getDb(): Db {
  if (!db) {
    const url = process.env["DATABASE_URL"] ?? process.env["POSTGRES_URL"]
    if (!url) throw new Error("DATABASE_URL (or POSTGRES_URL) is not set")
    db = createNodeDb(url, { max: 3 })
  }
  return db
}
