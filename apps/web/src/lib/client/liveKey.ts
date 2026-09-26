"use client"
import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid"
import { createWalletClient, custom } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { sealAgentKey } from "@slipstream/vault/seal"
import { connect, injected } from "./wallet"

/**
 * Connect Hyperliquid for live copy trading (docs/04 §2):
 *  1. a fresh key is generated here, in this tab;
 *  2. YOUR wallet signs `approveAgent`, registering that key on Hyperliquid as
 *     a trade-only agent of your account (it can place orders, never withdraw);
 *  3. the key is sealed to the engine's public key before it leaves the page,
 *     so the website only ever receives ciphertext;
 *  4. the server checks on-chain that it really is your agent before storing.
 * Re-running this replaces the previous agent (same agent name).
 */
export async function connectHyperliquidAgent(sessionAddress: string): Promise<string> {
  const enginePub = process.env["NEXT_PUBLIC_ENGINE_PUBLIC_KEY"]
  if (!enginePub) throw new Error("The engine key is not configured on this site.")
  const eth = injected()
  if (!eth) throw new Error("No browser wallet found.")
  const owner = await connect()
  if (owner.toLowerCase() !== sessionAddress.toLowerCase()) {
    throw new Error("Switch your wallet to the account you signed in with, then try again.")
  }
  let pk: `0x${string}` | null = generatePrivateKey()
  const agent = privateKeyToAccount(pk).address
  try {
    const wallet = createWalletClient({ account: owner, transport: custom(eth as never) })
    const exchange = new ExchangeClient({ transport: new HttpTransport(), wallet })
    await exchange.approveAgent({ agentAddress: agent, agentName: "slipstream" })
    const sealed = await sealAgentKey(enginePub, { venue: "hyperliquid", owner, agent }, pk)
    pk = null
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, agent, sealed }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) throw new Error(body.error ?? "The key could not be stored.")
    return agent
  } finally {
    pk = null
  }
}

/** A fresh signature for a sensitive action (docs/04 §5 step-up). */
export async function signStepUp(action: string): Promise<{ message: string; signature: string }> {
  const eth = injected()
  const address = await connect()
  const message = `Slipstream: ${action}\nIssued ${new Date().toISOString()}`
  const signature = (await eth!.request({ method: "personal_sign", params: [message, address] })) as string
  return { message, signature }
}
