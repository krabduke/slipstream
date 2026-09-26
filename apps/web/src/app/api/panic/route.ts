import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { setUserKill } from "@slipstream/db/queries/index"
import type { UserId } from "@slipstream/shared"
import { getDb } from "@/lib/db"
import { getSession } from "@/lib/session"

/** The panic button: "stop" halts every new entry; "flatten" also closes every
 *  position; "off" lifts it. Exits are never blocked by any of these. */
const Body = z.object({ action: z.enum(["stop", "flatten", "off"]) })

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Unknown action." }, { status: 400 })
  const a = parsed.data.action
  await setUserKill(session.userId as UserId, getDb(), { active: a !== "off", flatten: a === "flatten" })
  return NextResponse.json({ ok: true })
}
