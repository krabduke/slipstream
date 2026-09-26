import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { setSubscriptionKill, TenantScopeError } from "@slipstream/db/queries/index"
import type { SubscriptionId, UserId } from "@slipstream/shared"
import { getDb } from "@/lib/db"
import { getSession } from "@/lib/session"

const Body = z.object({ action: z.enum(["pause", "resume", "stop"]) })

/** pause: no new entries, exits still run. stop: close this follow's positions, then end it. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  const { id } = await params
  if (!parsed.success || !/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Unknown action." }, { status: 400 })
  const a = parsed.data.action
  try {
    await setSubscriptionKill(session.userId as UserId, getDb(), id as SubscriptionId, {
      active: a !== "resume",
      flatten: a === "stop",
    })
  } catch (e) {
    if (e instanceof TenantScopeError) return NextResponse.json({ error: "Follow not found." }, { status: 404 })
    throw e
  }
  return NextResponse.json({ ok: true })
}
