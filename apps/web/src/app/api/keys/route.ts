import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  deleteEncryptedKey,
  findVenueAccountByOwner,
  insertAuditEntry,
  insertVenueAccount,
  setVenueAccountSigner,
  setVenueAccountStatus,
  upsertEncryptedKey,
} from "@slipstream/db/queries/index"
import { asAddress } from "@slipstream/shared"
import type { UserId, VenueAccountId } from "@slipstream/shared"
import { createHyperliquidAdapter } from "@slipstream/venues/hyperliquid/index"
import { getDb } from "@/lib/db"
import { getSession, isLiveAllowed } from "@/lib/session"

/**
 * Store a Hyperliquid agent key for live copy trading.
 *
 * The key arrives SEALED to the engine's public key (the browser did that
 * before sending it), so this server never holds anything that can sign. What
 * it does check, before storing, is the rule everything rests on (docs/04 §1):
 * the signer must be a registered agent of the owner and not the owner itself.
 * Anything else is refused and nothing is written.
 */
const Sealed = z.object({
  v: z.literal(1),
  alg: z.literal("RSA-OAEP-256+A256GCM"),
  wrappedDek: z.string().max(2000),
  iv: z.string().max(64),
  ciphertext: z.string().max(4000),
  tag: z.string().max(64),
  keyId: z.string().regex(/^[0-9a-f]{16}$/),
})
const Body = z.object({
  owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  agent: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  sealed: Sealed,
})

const hl = createHyperliquidAdapter()

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 })
  if (!isLiveAllowed(session.address)) {
    return NextResponse.json({ error: "Live trading is limited to the operator's own wallets." }, { status: 403 })
  }
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Malformed key submission." }, { status: 400 })
  const { owner, agent, sealed } = parsed.data
  if (owner.toLowerCase() !== session.address.toLowerCase()) {
    return NextResponse.json({ error: "The approving wallet must be the one you signed in with." }, { status: 403 })
  }
  let proof
  try {
    proof = await hl.verifyDelegation(asAddress(owner), asAddress(agent))
  } catch (e) {
    return NextResponse.json(
      { error: `Hyperliquid does not list this key as a trade-only agent of your account, so it was not stored. ${e instanceof Error ? e.message : ""}`.trim() },
      { status: 400 },
    )
  }
  const uid = session.userId as UserId
  const db = getDb()
  const material = {
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    tag: sealed.tag,
    wrappedDek: sealed.wrappedDek,
    kmsKeyId: `engine-rsa-oaep:${sealed.keyId}`,
  }
  // Signer and sealed key change together: the ciphertext is bound to the
  // agent address, so the two must never disagree.
  await db.transaction(async (tx) => {
    const t = tx as unknown as typeof db
    let account = await findVenueAccountByOwner(uid, t, "hyperliquid", owner)
    if (!account) {
      account = await insertVenueAccount(uid, t, {
        venue: "hyperliquid",
        ownerAddress: owner,
        signerAddress: agent,
        delegationMethod: proof.method,
        verifiedAt: new Date(proof.verifiedAt),
      })
    } else {
      account = await setVenueAccountSigner(uid, t, account.id as VenueAccountId, agent)
      await setVenueAccountStatus(uid, t, account.id as VenueAccountId, "active")
    }
    await upsertEncryptedKey(uid, t, account.id as VenueAccountId, material)
    await insertAuditEntry(uid, t, {
      action: "hyperliquid_agent_key_stored",
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      detail: { owner: owner.toLowerCase(), agent: agent.toLowerCase(), keyId: sealed.keyId, proof: proof.method.slice(0, 400) },
    })
  })
  return NextResponse.json({ ok: true, agent: agent.toLowerCase() })
}

/** Forget the stored key. (Revoking it on Hyperliquid is the user's own step.) */
export async function DELETE() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 })
  const uid = session.userId as UserId
  const db = getDb()
  const account = await findVenueAccountByOwner(uid, db, "hyperliquid", session.address)
  if (!account) return NextResponse.json({ ok: true, removed: false })
  const removed = await deleteEncryptedKey(uid, db, account.id as VenueAccountId)
  await setVenueAccountStatus(uid, db, account.id as VenueAccountId, "revoked")
  await insertAuditEntry(uid, db, { action: "hyperliquid_agent_key_removed", ip: null, detail: { owner: session.address } })
  return NextResponse.json({ ok: true, removed })
}
