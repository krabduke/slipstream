import { NextResponse } from "next/server"
import { getSession, isLiveAllowed } from "@/lib/session"

export async function GET() {
  const s = await getSession()
  return NextResponse.json(
    s ? { address: s.address, liveAllowed: isLiveAllowed(s.address) } : { address: null, liveAllowed: false },
    { headers: { "Cache-Control": "no-store" } },
  )
}
