"use client"
import { useState } from "react"
import { signStepUp } from "@/lib/client/liveKey"
import { RANGES, loosens, type EditableLimits } from "@/lib/limits"

const FIELDS: { k: keyof EditableLimits; label: string; unit: string; help: string }[] = [
  { k: "perPositionUsd", label: "Largest position", unit: "$", help: "No single copied position grows past this." },
  { k: "perPositionPct", label: "Largest position as a share of balance", unit: "%", help: "The same limit, relative to your balance." },
  { k: "exposurePct", label: "Total exposure", unit: "%", help: "All open positions together, as a share of balance." },
  { k: "leverage", label: "Leverage", unit: "×", help: "At 3×, a 33% move against the account liquidates it." },
  { k: "dailyLossPct", label: "Daily loss stop", unit: "%", help: "Once today's losses reach this, nothing new opens until tomorrow (UTC)." },
]

export function LimitsForm({ current }: { current: EditableLimits }) {
  const [v, setV] = useState<EditableLimits>(current)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const raising = loosens(v, current)
  return (
    <form
      className="follow-form limits"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setMsg(null)
        try {
          const step = raising ? await signStepUp("Loosen my Slipstream risk limits") : {}
          const res = await fetch("/api/limits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...v, ...step }) })
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          if (!res.ok) throw new Error(body.error ?? "Could not save.")
          setMsg({ ok: true, text: "Saved. The engine applies these on its next cycle." })
        } catch (err) {
          setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not save." })
        } finally {
          setBusy(false)
        }
      }}
    >
      {FIELDS.map((f) => (
        <div key={f.k}>
          <label className="follow-field">
            <span>{f.label}</span>
            <span className="follow-input">
              {f.unit === "$" ? <span className="unit">$</span> : null}
              <input
                type="number"
                step="any"
                min={RANGES[f.k][0]}
                max={RANGES[f.k][1]}
                value={v[f.k]}
                onChange={(e) => setV({ ...v, [f.k]: Number(e.target.value) })}
                required
              />
              {f.unit !== "$" ? <span className="unit">{f.unit}</span> : null}
            </span>
          </label>
          <p className="follow-help">{f.help}</p>
        </div>
      ))}
      <button type="submit" className="btn" disabled={busy}>
        {busy ? "Saving" : raising ? "Sign and save" : "Save limits"}
      </button>
      {raising ? <p className="follow-help">You are raising a limit, so your wallet will ask for a confirmation signature.</p> : null}
      {msg ? <p className={msg.ok ? "dim small" : "follow-error"} role="status">{msg.text}</p> : null}
    </form>
  )
}
