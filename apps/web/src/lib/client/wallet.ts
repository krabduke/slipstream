"use client"
import { createSiweMessage } from "viem/siwe"

/** The injected wallet (MetaMask, Rabby, ...). Kept minimal on purpose: no
 *  wallet-connection framework, because nothing here needs more than
 *  "which account" and "sign this". */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
}

export function injected(): Eip1193 | null {
  return typeof window !== "undefined" ? ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null) : null
}

export async function connect(): Promise<`0x${string}`> {
  const eth = injected()
  if (!eth) throw new Error("No browser wallet found. Install MetaMask or Rabby, then try again.")
  const [account] = (await eth.request({ method: "eth_requestAccounts" })) as `0x${string}`[]
  if (!account) throw new Error("The wallet returned no account.")
  return account
}

export async function signIn(): Promise<string> {
  const eth = injected()
  const address = await connect()
  const chainId = Number.parseInt((await eth!.request({ method: "eth_chainId" })) as string, 16)
  const { nonce } = (await (await fetch("/api/auth/nonce", { method: "POST" })).json()) as { nonce: string }
  const message = createSiweMessage({
    domain: window.location.host,
    address,
    statement: "Sign in to Slipstream. This signature costs nothing and cannot move funds.",
    uri: window.location.origin,
    version: "1",
    chainId,
    nonce,
    expirationTime: new Date(Date.now() + 10 * 60_000),
  })
  const signature = await eth!.request({ method: "personal_sign", params: [message, address] })
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  })
  const body = (await res.json()) as { address?: string; error?: string }
  if (!res.ok || !body.address) throw new Error(body.error ?? "Sign-in failed.")
  return body.address
}
