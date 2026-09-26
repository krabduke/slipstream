"use client"
import { useState } from "react"
import { signIn } from "@/lib/client/wallet"

export function SignInPrompt({ what }: { what: string }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="empty-card">
      <p>Sign in with your wallet to {what}. Signing costs nothing and cannot move funds.</p>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          setError(null)
          try {
            await signIn()
            window.location.reload()
          } catch (e) {
            setError(e instanceof Error ? e.message : "Sign-in failed.")
          }
        }}
      >
        Sign in with wallet
      </button>
      {error ? <p className="follow-error" role="alert">{error}</p> : null}
    </div>
  )
}
