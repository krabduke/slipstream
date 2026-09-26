/**
 * Opening agent keys for live trading.
 *
 * The private half of the engine keypair lives only on this host
 * (ENGINE_KEY_FILE, chmod 600). A sealed agent key is opened for one signing
 * session, and only after its delegation is re-verified on-chain: the key must
 * still be a registered agent of the owner (docs/04 §1). Anything else —
 * missing file, tampered ciphertext, revoked agent — fails closed.
 */
import { readFileSync } from "node:fs"

import { asAddress } from "@slipstream/shared"
import { asSignerKey, type SignerKey } from "@slipstream/shared/secret.js"
import { openAgentKey } from "@slipstream/vault/seal.js"

import type { Db } from "@slipstream/db"
import { loadSealedKey } from "./store.js"
import { hl } from "./venues.js"

const VERIFY_TTL_MS = 10 * 60_000
const verified = new Map<string, number>()

let enginePrivateKey: string | null = null
function engineKey(): string {
  if (enginePrivateKey === null) {
    const path = process.env["ENGINE_KEY_FILE"] ?? `${process.env["HOME"]}/slipstream-engine/engine-key.pk8`
    enginePrivateKey = readFileSync(path, "utf8").trim()
  }
  return enginePrivateKey
}

export async function openLiveKey(
  db: Db,
  follow: { venue: string; venueAccountId: string; ownerAddress: string; signerAddress: string },
): Promise<SignerKey> {
  if (follow.venue !== "hyperliquid") throw new Error("live trading is only available on Hyperliquid")
  const row = await loadSealedKey(db, follow.venueAccountId)
  if (!row) throw new Error("no key on file for this account")
  const binding = { venue: follow.venue, owner: follow.ownerAddress, agent: follow.signerAddress }
  const pk = await openAgentKey(engineKey(), binding, {
    wrappedDek: row.wrappedDek,
    iv: row.iv,
    ciphertext: row.ciphertext,
    tag: row.tag,
  })
  const cacheKey = `${follow.ownerAddress}:${follow.signerAddress}`
  if ((verified.get(cacheKey) ?? 0) < Date.now() - VERIFY_TTL_MS) {
    // Throws unless the signer is a current, non-owner agent of the owner.
    await hl.verifyDelegation(asAddress(follow.ownerAddress), asAddress(follow.signerAddress))
    verified.set(cacheKey, Date.now())
  }
  return asSignerKey(pk)
}
