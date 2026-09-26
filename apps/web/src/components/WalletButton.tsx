"use client"
import { useEffect, useState } from "react"
import { signIn } from "@/lib/client/wallet"

type Me = { address: string | null; liveAllowed: boolean }

export function WalletButton() {
  const [me, setMe] = useState<Me | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json() as Promise<Me>)
      .then(setMe)
      .catch(() => setMe({ address: null, liveAllowed: false }))
  }, [])

  if (me === null) return <span className="wallet wallet-pending" aria-hidden="true" />

  if (me.address) {
    return (
      <span className="wallet">
        <span className="num wallet-addr" title={me.address}>
          {me.address.slice(0, 6)}…{me.address.slice(-4)}
        </span>
        <button
          type="button"
          className="linklike"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" })
            window.location.reload()
          }}
        >
          Sign out
        </button>
      </span>
    )
  }

  return (
    <span className="wallet">
      <button
        type="button"
        className="btn btn-quiet"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await signIn()
            window.location.reload()
          } catch (e) {
            setError(e instanceof Error ? e.message : "Sign-in failed.")
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? "Check your wallet" : "Sign in with wallet"}
      </button>
      {error ? <span className="wallet-error" role="alert">{error}</span> : null}
    </span>
  )
}
