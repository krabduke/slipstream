import { NextResponse } from "next/server"
import { generateSiweNonce } from "viem/siwe"
import { createNonce } from "@slipstream/db/queries/auth"
import { getDb } from "@/lib/db"

export async function POST() {
  const nonce = generateSiweNonce()
  await createNonce(getDb(), nonce)
  return NextResponse.json({ nonce }, { headers: { "Cache-Control": "no-store" } })
}
