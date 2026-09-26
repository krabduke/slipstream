import { NextResponse } from "next/server"
import { sql } from "drizzle-orm"
import { getDb } from "@/lib/db"
import { getSession } from "@/lib/session"

/** What the status band shows: engine heartbeat, copy health, and whether this
 *  viewer has any live follow (which turns the paper stripe off). */
export async function GET() {
  const db = getDb()
  const r = await db.execute(sql`select holder, heartbeat_at from engine_leases where shard = 0`)
  const row = (r as unknown as { rows: { holder: string; heartbeat_at: string | Date }[] }).rows[0]
  let copy: { at: number; follows: number; errors: number } | null = null
  try {
    copy = row ? (JSON.parse(row.holder) as { copy: typeof copy }).copy : null
  } catch {
    copy = null
  }
  const beatSecs = row ? Math.max(0, Math.round((Date.now() - new Date(row.heartbeat_at).getTime()) / 1000)) : null
  const session = await getSession()
  let live = false
  if (session) {
    const lr = await db.execute(sql`select 1 from subscriptions where user_id = ${session.userId} and is_paper = false and status = 'active' limit 1`)
    live = (lr as unknown as { rows: unknown[] }).rows.length > 0
  }
  return NextResponse.json(
    { engineHeartbeatSecs: beatSecs, copy, mode: live ? "live" : "paper" },
    { headers: { "Cache-Control": "no-store" } },
  )
}
