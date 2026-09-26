import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Supabase serves every public table over PostgREST with a public anon key.
 * Slipstream never uses that path, so every table must have RLS enabled (with
 * no policies) to close it. A table created without it is readable, and
 * writable, by anyone holding the anon key — including encrypted_keys.
 */
describe("every table is closed to PostgREST", () => {
  it("has ENABLE ROW LEVEL SECURITY for each CREATE TABLE across migrations", () => {
    const dir = join(__dirname, "..", "..", "migrations")
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n")
    const created = [...sql.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map((m) => m[1])
    const locked = new Set([...sql.matchAll(/ALTER TABLE "([a-z_]+)" ENABLE ROW LEVEL SECURITY/g)].map((m) => m[1]))
    expect(created.length).toBeGreaterThan(0)
    expect(created.filter((t) => !locked.has(t))).toEqual([])
  })
})
