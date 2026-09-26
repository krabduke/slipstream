import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { FollowLimitError, createPaperFollow, getTraderProfile } from "@slipstream/db/queries/index"
import type { UserId } from "@slipstream/shared"
import { getDb } from "@/lib/db"
import { getSession } from "@/lib/session"

// "Their size x k" is deliberately not offered here: a whale's routine trade
// can exceed a whole account (docs/03 §3).
const Body = z.object({
  venue: z.enum(["hyperliquid", "polymarket"]),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  sizingMode: z.enum(["equity_ratio", "fixed_notional", "percent_equity"]),
  sizingValue: z.number().positive(),
  startingEquity: z.number().min(100).max(10_000_000),
})

const RANGES = {
  equity_ratio: [0.1, 5],
  fixed_notional: [10, 100_000],
  percent_equity: [0.5, 50],
} as const

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Sign in with your wallet to follow a trader." }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Check the follow settings and try again." }, { status: 400 })
  const b = parsed.data
  const [lo, hi] = RANGES[b.sizingMode]
  if (b.sizingValue < lo || b.sizingValue > hi) {
    return NextResponse.json({ error: `That size must be between ${lo} and ${hi}.` }, { status: 400 })
  }
  const db = getDb()
  const profile = await getTraderProfile(db, b.venue, b.address)
  try {
    const sub = await createPaperFollow(session.userId as UserId, db, {
      venue: b.venue,
      leaderAddress: b.address,
      leaderLabel: profile?.displayName ?? null,
      sizingMode: b.sizingMode,
      sizingParam: String(b.sizingValue),
      startingEquity: String(b.startingEquity),
    })
    return NextResponse.json({ id: sub.id })
  } catch (e) {
    if (e instanceof FollowLimitError) return NextResponse.json({ error: e.message }, { status: 409 })
    throw e
  }
}
