/**
 * Sealing agent keys to the engine (docs/04 §2, strengthened 2026-09-26).
 *
 * The original plan had the browser POST the plaintext agent key to the web
 * server, which then encrypted it. Here the BROWSER seals it, to the engine's
 * public key, before it leaves the page: the web server only ever sees
 * ciphertext, and only the engine — which holds the private key on its own
 * host — can open it. Compromising the website yields nothing usable.
 *
 * Scheme: a fresh AES-256-GCM key encrypts the agent key; RSA-OAEP-256 wraps
 * that AES key. The GCM associated data binds the ciphertext to the venue,
 * owner and agent addresses, so a sealed key copied onto another account's row
 * fails authentication instead of signing for the wrong account.
 *
 * WebCrypto only, so the identical code runs in browsers and in Node 22.
 */
const subtle = () => {
  const s = globalThis.crypto?.subtle
  if (!s) throw new Error("WebCrypto is not available in this environment")
  return s
}

export interface SealedKey {
  readonly v: 1
  readonly alg: "RSA-OAEP-256+A256GCM"
  /** base64 RSA-OAEP(SHA-256) of the 32-byte AES key */
  readonly wrappedDek: string
  /** base64 12-byte GCM nonce */
  readonly iv: string
  /** base64 ciphertext, GCM tag split off */
  readonly ciphertext: string
  /** base64 16-byte GCM tag */
  readonly tag: string
  /** SHA-256 of the engine public key (hex, first 16), so a rotated engine key is detectable */
  readonly keyId: string
}

const b64 = (bytes: ArrayBuffer | Uint8Array) => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ""
  for (const x of u) s += String.fromCharCode(x)
  return btoa(s)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export const sealBinding = (venue: string, owner: string, agent: string) =>
  new TextEncoder().encode(`slipstream/agent-key/v1|${venue}|${owner.toLowerCase()}|${agent.toLowerCase()}`)

async function keyId(spkiB64: string): Promise<string> {
  const h = await subtle().digest("SHA-256", unb64(spkiB64))
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16)
}

/** Browser side. `enginePublicKey` is base64 SPKI (RSA-OAEP, SHA-256). */
export async function sealAgentKey(
  enginePublicKey: string,
  binding: { venue: string; owner: string; agent: string },
  privateKeyHex: string,
): Promise<SealedKey> {
  const s = subtle()
  const pub = await s.importKey("spki", unb64(enginePublicKey), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"])
  const dek = await s.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"])
  const raw = new Uint8Array(await s.exportKey("raw", dek))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const plain = new TextEncoder().encode(privateKeyHex)
  const sealed = new Uint8Array(
    await s.encrypt({ name: "AES-GCM", iv, additionalData: sealBinding(binding.venue, binding.owner, binding.agent) }, dek, plain),
  )
  const wrapped = await s.encrypt({ name: "RSA-OAEP" }, pub, raw)
  raw.fill(0)
  plain.fill(0)
  return {
    v: 1,
    alg: "RSA-OAEP-256+A256GCM",
    wrappedDek: b64(wrapped),
    iv: b64(iv),
    ciphertext: b64(sealed.slice(0, sealed.length - 16)),
    tag: b64(sealed.slice(sealed.length - 16)),
    keyId: await keyId(enginePublicKey),
  }
}

/** Engine side. `privateKeyPkcs8` is base64 PKCS#8. Throws on any tampering. */
export async function openAgentKey(
  privateKeyPkcs8: string,
  binding: { venue: string; owner: string; agent: string },
  sealed: Pick<SealedKey, "wrappedDek" | "iv" | "ciphertext" | "tag">,
): Promise<string> {
  const s = subtle()
  const priv = await s.importKey("pkcs8", unb64(privateKeyPkcs8), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"])
  const raw = new Uint8Array(await s.decrypt({ name: "RSA-OAEP" }, priv, unb64(sealed.wrappedDek)))
  const dek = await s.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"])
  raw.fill(0)
  const ct = unb64(sealed.ciphertext)
  const tag = unb64(sealed.tag)
  const joined = new Uint8Array(ct.length + tag.length)
  joined.set(ct)
  joined.set(tag, ct.length)
  const plain = new Uint8Array(
    await s.decrypt(
      { name: "AES-GCM", iv: unb64(sealed.iv), additionalData: sealBinding(binding.venue, binding.owner, binding.agent) },
      dek,
      joined,
    ),
  )
  const out = new TextDecoder().decode(plain)
  plain.fill(0)
  return out
}

/** Generate the engine's keypair (run once on the engine host). */
export async function generateEngineKeypair(): Promise<{ publicKey: string; privateKey: string; keyId: string }> {
  const s = subtle()
  const kp = (await s.generateKey(
    { name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  )) as CryptoKeyPair
  const publicKey = b64(await s.exportKey("spki", kp.publicKey))
  const privateKey = b64(await s.exportKey("pkcs8", kp.privateKey))
  return { publicKey, privateKey, keyId: await keyId(publicKey) }
}
