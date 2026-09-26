import { NextResponse, type NextRequest } from "next/server"
import { verifyMessage } from "viem"
import { z } from "zod"
import { and, eq } from "drizzle-orm"
import { schema } from "@slipstream/db"
import { findVenueAccountByOwner, getEncryptedKey, insertAuditEntry, setSubscriptionPaperMode } from "@slipstream/db/queries/index"
import type { SubscriptionId, UserId, VenueAccountId } from "@slipstream/shared"
import { getDb } from "@/lib/db"
import { getSession, isLiveAllowed } from "@/lib/session"

/**
 * Move a follow between paper and live. Going live is a step-up action: it
 * needs a fresh signature naming this follow, signed within the last 5
 * minutes, not just a session cookie (docs/04 §5).
 */
const Body = z.object({ live: z.boolean(), message: z.string().max(500), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 })
  const { id } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success || !/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Malformed request." }, { status: 400 })
  const { live, message, signature } = parsed.data
  const uid = session.userId as UserId
  const db = getDb()

  if (live) {
    if (!isLiveAllowed(session.address)) return NextResponse.json({ error: "Live trading is limited to the operator's own wallets." }, { status: 403 })
    const issued = /Issued (\S+)$/.exec(message)?.[1]
    const fresh = issued && Date.now() - new Date(issued).getTime() < 5 * 60_000
    if (!message.includes(`Enable live trading for follow ${id}`) || !fresh) {
      return NextResponse.json({ error: "Sign the confirmation again; it must name this follow and be recent." }, { status: 400 })
    }
    const ok = await verifyMessage({ address: session.address as `0x${string}`, message, signature: signature as `0x${string}` }).catch(() => false)
    if (!ok) return NextResponse.json({ error: "The signature does not match your account." }, { status: 401 })
  }

  const [sub] = await db
    .select({ id: schema.subscriptions.id, leaderId: schema.subscriptions.leaderId })
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.userId, uid)))
    .limit(1)
  if (!sub) return NextResponse.json({ error: "Follow not found." }, { status: 404 })
  const [leader] = await db.select({ venue: schema.leaders.venue }).from(schema.leaders).where(eq(schema.leaders.id, sub.leaderId)).limit(1)
  if (leader?.venue !== "hyperliquid") return NextResponse.json({ error: "Live trading is available on Hyperliquid only." }, { status: 400 })

  // Live runs against the real account; paper against the paper account.
  const owner = live ? session.address : `paper:${session.address}`
  const account = await findVenueAccountByOwner(uid, db, "hyperliquid", owner)
  if (!account || (live && (account.status !== "active" || !(await getEncryptedKey(uid, db, account.id as VenueAccountId))))) {
    return NextResponse.json({ error: live ? "Connect Hyperliquid in Settings first." : "Paper account missing." }, { status: 400 })
  }
  await db.update(schema.subscriptions).set({ venueAccountId: account.id }).where(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.userId, uid)))
  await setSubscriptionPaperMode(uid, db, id as SubscriptionId, !live)
  await insertAuditEntry(uid, db, { action: live ? "follow_live_enabled" : "follow_paper_restored", ip: null, detail: { subscriptionId: id } })
  return NextResponse.json({ ok: true })
}
