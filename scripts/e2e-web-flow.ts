// E2E against a running site: sign in with a throwaway key, follow, pause, read pages.
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts"
import { createSiweMessage } from "viem/siwe"
const BASE = process.argv[2] ?? "http://localhost:3931"
const acct = privateKeyToAccount(generatePrivateKey())
let cookie = ""
const req = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(BASE + path, { ...init, headers: { ...(init.headers ?? {}), "Content-Type": "application/json", cookie } })
  const set = r.headers.get("set-cookie"); if (set) cookie = set.split(";")[0]!
  return r
}
const { nonce } = await (await req("/api/auth/nonce", { method: "POST" })).json()
const message = createSiweMessage({ domain: new URL(BASE).host, address: acct.address, statement: "Sign in to Slipstream.", uri: BASE, version: "1", chainId: 1, nonce, expirationTime: new Date(Date.now() + 600_000) })
const signature = await acct.signMessage({ message })
const v = await req("/api/auth/verify", { method: "POST", body: JSON.stringify({ message, signature }) })
console.log("verify", v.status, await v.json())
const replay = await fetch(BASE + "/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, signature }) })
console.log("replayed signature ->", replay.status)
console.log("me", await (await req("/api/auth/me")).json())
const bad = await req("/api/follows", { method: "POST", body: JSON.stringify({ venue: "hyperliquid", address: "0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00", sizingMode: "fixed_notional", sizingValue: 5, startingEquity: 10000 }) })
console.log("out-of-range size ->", bad.status, (await bad.json()).error)
const f = await req("/api/follows", { method: "POST", body: JSON.stringify({ venue: "hyperliquid", address: "0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00", sizingMode: "fixed_notional", sizingValue: 250, startingEquity: 5000 }) })
const { id } = await f.json(); console.log("follow", f.status, id)
console.log("pause", (await req(`/api/follows/${id}/control`, { method: "POST", body: JSON.stringify({ action: "pause" }) })).status)
const fp = await (await req("/follows")).text()
console.log("follows page shows follow:", fp.includes("$250 per position"), "paused:", fp.includes("Paused"), "balance:", fp.includes("$5.0k"))
const ap = await (await req("/activity")).text()
console.log("activity page ok:", ap.includes("Every decision the engine makes"))
const anon = await fetch(BASE + "/api/follows", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
console.log("anonymous follow ->", anon.status)
console.log("status", await (await req("/api/status")).json())
console.log(JSON.stringify({ address: acct.address.toLowerCase() }))
process.exit(0)
