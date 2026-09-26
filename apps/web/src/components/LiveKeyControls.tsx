"use client"
import { useState } from "react"
import { connectHyperliquidAgent, signStepUp } from "@/lib/client/liveKey"

export function ConnectHyperliquid({ address, connected }: { address: string; connected: boolean }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  return (
    <div className="controls">
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setMsg(null)
          try {
            const agent = await connectHyperliquidAgent(address)
            setMsg({ ok: true, text: `Connected. Trade-only key ${agent.slice(0, 6)}…${agent.slice(-4)} is registered and stored sealed.` })
            setTimeout(() => window.location.reload(), 1500)
          } catch (e) {
            setMsg({ ok: false, text: e instanceof Error ? e.message : "Connecting failed." })
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? "Check your wallet" : connected ? "Replace the key" : "Connect Hyperliquid"}
      </button>
      {connected ? (
        <button
          type="button"
          className="btn btn-quiet btn-danger"
          disabled={busy}
          onClick={async () => {
            await fetch("/api/keys", { method: "DELETE" })
            window.location.reload()
          }}
        >
          Remove the key
        </button>
      ) : null}
      {msg ? <p className={msg.ok ? "dim small" : "follow-error"} role="status">{msg.text}</p> : null}
    </div>
  )
}

export function GoLive({ id, live }: { id: string; live: boolean }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <span className="controls">
      <button
        type="button"
        className={live ? "btn btn-quiet" : "btn btn-quiet btn-danger"}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setErr(null)
          try {
            const step = live
              ? { message: "", signature: "0x00" }
              : await signStepUp(`Enable live trading for follow ${id}. Real orders will be placed on my Hyperliquid account.`)
            const res = await fetch(`/api/follows/${id}/live`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ live: !live, ...step }),
            })
            const body = (await res.json().catch(() => ({}))) as { error?: string }
            if (!res.ok) throw new Error(body.error ?? "Could not switch.")
            window.location.reload()
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not switch.")
          } finally {
            setBusy(false)
          }
        }}
      >
        {live ? "Back to paper" : "Go live"}
      </button>
      {err ? <span className="follow-error">{err}</span> : null}
    </span>
  )
}
