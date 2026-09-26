import { NextResponse, type NextRequest } from "next/server"
import { verifyMessage } from "viem"
import { parseSiweMessage, validateSiweMessage } from "viem/siwe"
import { z } from "zod"
import { consumeNonce, upsertUserByAddress } from "@slipstream/db/queries/auth"
import { getDb } from "@/lib/db"
import { issueSession } from "@/lib/session"

const Body = z.object({ message: z.string().max(2000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) })

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Malformed sign-in request." }, { status: 400 })
  const { message, signature } = parsed.data
  const fields = parseSiweMessage(message)
  const host = req.headers.get("host") ?? ""
  // Domain, expiry and presence of the fields; the nonce is checked against
  // the database below so each one works exactly once.
  if (!fields.address || !fields.nonce || !validateSiweMessage({ message: fields, domain: host })) {
    return NextResponse.json({ error: "This sign-in message is not for this site or has expired." }, { status: 400 })
  }
  const valid = await verifyMessage({ address: fields.address, message, signature: signature as `0x${string}` }).catch(() => false)
  if (!valid) return NextResponse.json({ error: "The signature does not match the address." }, { status: 401 })
  const db = getDb()
  if (!(await consumeNonce(db, fields.nonce, fields.address))) {
    return NextResponse.json({ error: "This sign-in request was already used or has expired. Try again." }, { status: 401 })
  }
  const user = await upsertUserByAddress(db, fields.address)
  await issueSession({ userId: user.id, address: user.address })
  return NextResponse.json({ address: user.address })
}
