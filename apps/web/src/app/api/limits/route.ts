import { NextResponse, type NextRequest } from "next/server"
import { verifyMessage } from "viem"
import { z } from "zod"
import { getRiskProfile, insertAuditEntry, insertRiskProfile, updateRiskProfile } from "@slipstream/db/queries/index"
import type { UserId } from "@slipstream/shared"
import { getDb } from "@/lib/db"
import { RANGES, fromRow, loosens, type EditableLimits } from "@/lib/limits"
import { getSession } from "@/lib/session"

const Body = z.object({
  perPositionUsd: z.number(),
  perPositionPct: z.number(),
  exposurePct: z.number(),
  leverage: z.number(),
  dailyLossPct: z.number(),
  message: z.string().max(500).optional(),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
})

/** Tightening applies at once; loosening needs a fresh signed confirmation (docs/04 §5). */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Check the values and try again." }, { status: 400 })
  const next: EditableLimits = {
    perPositionUsd: parsed.data.perPositionUsd,
    perPositionPct: parsed.data.perPositionPct,
    exposurePct: parsed.data.exposurePct,
    leverage: parsed.data.leverage,
    dailyLossPct: parsed.data.dailyLossPct,
  }
  for (const [k, [lo, hi]] of Object.entries(RANGES) as [keyof EditableLimits, [number, number]][]) {
    if (!(next[k] >= lo && next[k] <= hi)) return NextResponse.json({ error: `${k} must be between ${lo} and ${hi}.` }, { status: 400 })
  }
  const uid = session.userId as UserId
  const db = getDb()
  const row = await getRiskProfile(uid, db, null)
  const current = fromRow(row)
  if (loosens(next, current)) {
    const { message, signature } = parsed.data
    const issued = message ? /Issued (\S+)$/.exec(message)?.[1] : undefined
    const fresh = issued && Date.now() - new Date(issued).getTime() < 5 * 60_000
    const ok =
      message?.includes("Loosen my Slipstream risk limits") && fresh && signature
        ? await verifyMessage({ address: session.address as `0x${string}`, message, signature: signature as `0x${string}` }).catch(() => false)
        : false
    if (!ok) return NextResponse.json({ error: "Loosening a limit needs a fresh signature.", needsSignature: true }, { status: 403 })
  }
  const values = {
    maxNotionalPerPosition: next.perPositionUsd.toFixed(2),
    maxPositionPctEquity: (next.perPositionPct / 100).toFixed(4),
    maxTotalExposure: (next.exposurePct / 100).toFixed(4),
    maxLeverage: next.leverage.toFixed(2),
    dailyLossLimit: (next.dailyLossPct / 100).toFixed(4),
    // Kept for the schema; the engine uses per-venue defaults for these.
    maxSlippageBps: 50,
    maxSignalAgeMs: 5_000,
    maxBookPct: "0.2",
  }
  if (row) await updateRiskProfile(uid, db, null, values)
  else await insertRiskProfile(uid, db, null, values)
  await insertAuditEntry(uid, db, {
    action: "risk_limits_changed",
    ip: null,
    detail: { from: JSON.stringify(current), to: JSON.stringify(next) },
  })
  return NextResponse.json({ ok: true })
}
