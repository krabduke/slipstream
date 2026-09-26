"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { signIn } from "@/lib/client/wallet"

type Mode = "equity_ratio" | "fixed_notional" | "percent_equity"

const MODES: { key: Mode; label: string; unit: string; initial: number; help: string }[] = [
  {
    key: "equity_ratio",
    label: "In proportion to account size",
    unit: "×",
    initial: 1,
    help: "Take the same share of your account as they take of theirs. 1× mirrors their risk exactly.",
  },
  {
    key: "fixed_notional",
    label: "A fixed amount per position",
    unit: "$",
    initial: 250,
    help: "Every position they open becomes one of this size, whatever size they use.",
  },
  {
    key: "percent_equity",
    label: "A share of your balance per position",
    unit: "%",
    initial: 5,
    help: "Each position is this percentage of your balance, so it grows and shrinks with the account.",
  },
]

export function FollowPanel({ venue, address, copyable }: { venue: string; address: string; copyable: boolean }) {
  const [me, setMe] = useState<string | null | undefined>(undefined)
  const [mode, setMode] = useState<Mode>("equity_ratio")
  const [value, setValue] = useState<number>(1)
  const [balance, setBalance] = useState<number>(10_000)
  const [state, setState] = useState<"idle" | "busy" | "done">("idle")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json() as Promise<{ address: string | null }>)
      .then((m) => setMe(m.address))
      .catch(() => setMe(null))
  }, [])

  const current = MODES.find((m) => m.key === mode)!

  if (state === "done") {
    return (
      <section className="follow" aria-live="polite">
        <p className="follow-title">Paper follow started</p>
        <p className="follow-note">
          New moves are copied from now on; positions they already hold are not chased. Every decision appears in{" "}
          <Link href="/activity">Activity</Link>, and the paper balance is on <Link href="/follows">Following</Link>.
        </p>
      </section>
    )
  }

  return (
    <section className="follow" aria-label="Follow this trader">
      <p className="follow-title">Follow in paper</p>
      <p className="follow-note">
        Paper trading fills against the live order book with pessimistic assumptions and no money involved.
        {copyable ? null : " This wallet is marked as not copyable; a paper follow will show you why."}
      </p>
      {me === null ? (
        <button
          type="button"
          className="btn"
          onClick={async () => {
            setError(null)
            try {
              setMe(await signIn())
            } catch (e) {
              setError(e instanceof Error ? e.message : "Sign-in failed.")
            }
          }}
        >
          Sign in with wallet to follow
        </button>
      ) : me === undefined ? null : (
        <form
          className="follow-form"
          onSubmit={async (e) => {
            e.preventDefault()
            setState("busy")
            setError(null)
            const res = await fetch("/api/follows", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ venue, address, sizingMode: mode, sizingValue: value, startingEquity: balance }),
            })
            const body = (await res.json().catch(() => ({}))) as { error?: string }
            if (res.ok) setState("done")
            else {
              setState("idle")
              setError(body.error ?? "Could not start the follow.")
            }
          }}
        >
          <fieldset className="follow-modes">
            <legend>Size each copy</legend>
            {MODES.map((m) => (
              <label key={m.key} className="follow-mode">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === m.key}
                  onChange={() => {
                    setMode(m.key)
                    setValue(m.initial)
                  }}
                />
                <span>{m.label}</span>
              </label>
            ))}
          </fieldset>
          <label className="follow-field">
            <span>{mode === "equity_ratio" ? "Multiplier" : mode === "fixed_notional" ? "Amount per position" : "Share of balance"}</span>
            <span className="follow-input">
              {current.unit === "$" ? <span className="unit">$</span> : null}
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min={mode === "equity_ratio" ? 0.1 : mode === "fixed_notional" ? 10 : 0.5}
                max={mode === "equity_ratio" ? 5 : mode === "fixed_notional" ? 100000 : 50}
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                required
              />
              {current.unit !== "$" ? <span className="unit">{current.unit}</span> : null}
            </span>
          </label>
          <p className="follow-help">{current.help}</p>
          <label className="follow-field">
            <span>Paper starting balance</span>
            <span className="follow-input">
              <span className="unit">$</span>
              <input type="number" min={100} max={10000000} step={100} value={balance} onChange={(e) => setBalance(Number(e.target.value))} required />
            </span>
          </label>
          <p className="follow-help">
            Default limits apply: at most $1,000 or 20% of the balance per position, 50% total exposure, 3× leverage, and
            no copy more than {venue === "hyperliquid" ? "0.5%" : "3%"} worse than the leader&rsquo;s own price.
          </p>
          <button type="submit" className="btn" disabled={state === "busy"}>
            {state === "busy" ? "Starting" : "Start paper follow"}
          </button>
        </form>
      )}
      {error ? <p className="follow-error" role="alert">{error}</p> : null}
    </section>
  )
}
