import { privateKeyToAccount, generatePrivateKey } from "viem/accounts"
import { createSiweMessage } from "viem/siwe"
import { sealAgentKey } from "@slipstream/vault/seal"
const BASE = "http://localhost:3931"
async function session(pk: `0x${string}`) {
  const acct = privateKeyToAccount(pk); let cookie = ""
  const req = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(BASE + path, { ...init, headers: { ...(init.headers ?? {}), "Content-Type": "application/json", cookie } })
    const set = r.headers.get("set-cookie"); if (set) cookie = set.split(";")[0]!
    return r
  }
  const { nonce } = await (await req("/api/auth/nonce", { method: "POST" })).json()
  const message = createSiweMessage({ domain: "localhost:3931", address: acct.address, uri: BASE, version: "1", chainId: 1, nonce })
  await req("/api/auth/verify", { method: "POST", body: JSON.stringify({ message, signature: await acct.signMessage({ message }) }) })
  return { acct, req }
}
const [ownerPk] = process.argv[2]!.split(" ") as [`0x${string}`]
const agentPk = generatePrivateKey(); const agent = privateKeyToAccount(agentPk).address
const pub = process.env.NEXT_PUBLIC_ENGINE_PUBLIC_KEY!
// 1. not allowlisted
const stranger = await session(generatePrivateKey())
const s1 = await stranger.req("/api/keys", { method: "POST", body: JSON.stringify({ owner: stranger.acct.address, agent, sealed: await sealAgentKey(pub, { venue: "hyperliquid", owner: stranger.acct.address, agent }, agentPk) }) })
console.log("stranger ->", s1.status, (await s1.json()).error)
// 2. allowlisted, agent not registered on Hyperliquid
const owner = await session(ownerPk)
console.log("me:", await (await owner.req("/api/auth/me")).json())
const s2 = await owner.req("/api/keys", { method: "POST", body: JSON.stringify({ owner: owner.acct.address, agent, sealed: await sealAgentKey(pub, { venue: "hyperliquid", owner: owner.acct.address, agent }, agentPk) }) })
console.log("unregistered agent ->", s2.status, String((await s2.json()).error).slice(0, 140))
// 3. allowlisted, but claims someone else's account
const s3 = await owner.req("/api/keys", { method: "POST", body: JSON.stringify({ owner: "0x" + "22".repeat(20), agent, sealed: await sealAgentKey(pub, { venue: "hyperliquid", owner: "0x" + "22".repeat(20), agent }, agentPk) }) })
console.log("other owner ->", s3.status, (await s3.json()).error)
const settings = await (await owner.req("/settings")).text()
console.log("settings says not connected:", settings.includes("Not connected."), "| shows connect button:", settings.includes("Connect Hyperliquid"))
console.log(JSON.stringify({ cleanup: [stranger.acct.address, owner.acct.address] }))
process.exit(0)
