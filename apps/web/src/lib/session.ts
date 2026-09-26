import "server-only"
import { cookies } from "next/headers"
import { SignJWT, jwtVerify } from "jose"

/**
 * Sessions: a short JWT in an httpOnly, Secure, SameSite=Lax cookie, issued
 * after a verified Sign-In-with-Ethereum signature (docs/04 §5). The token
 * carries only the user id and address; anything sensitive (enabling live
 * trading, adding a key) asks for a fresh signature on top.
 */
const COOKIE = "ss_session"
const TTL_S = 7 * 24 * 3600

export interface Session {
  readonly userId: string
  readonly address: string
}

function secret(): Uint8Array {
  const s = process.env["SESSION_SECRET"]
  if (!s || s.length < 32) throw new Error("SESSION_SECRET is missing or shorter than 32 characters")
  return new TextEncoder().encode(s)
}

export async function issueSession(s: Session): Promise<void> {
  const token = await new SignJWT({ addr: s.address })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.userId)
    .setIssuedAt()
    .setExpirationTime(`${TTL_S}s`)
    .sign(secret())
  ;(await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_S,
  })
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] })
    if (typeof payload.sub !== "string" || typeof payload["addr"] !== "string") return null
    return { userId: payload.sub, address: payload["addr"] }
  } catch {
    return null
  }
}

export async function clearSession(): Promise<void> {
  ;(await cookies()).delete(COOKIE)
}

/** Live trading is limited to the operator's own wallets (docs/BUILD.md). */
export function isLiveAllowed(address: string): boolean {
  const list = (process.env["LIVE_OWNER_ADDRESSES"] ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(address.toLowerCase())
}
