"use client"
import { useState } from "react"

/** Pause / resume / stop one follow. Stop asks first: it closes the follow's positions. */
export function FollowControls({ id, paused, stopping }: { id: string; paused: boolean; stopping: boolean }) {
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const send = async (action: "pause" | "resume" | "stop") => {
    setBusy(true)
    const res = await fetch(`/api/follows/${id}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
    setBusy(false)
    if (res.ok) window.location.reload()
  }
  if (stopping) return <span className="dim">Stopping: closing positions</span>
  return (
    <span className="controls">
      <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => send(paused ? "resume" : "pause")}>
        {paused ? "Resume" : "Pause"}
      </button>
      {confirm ? (
        <>
          <button type="button" className="btn btn-quiet btn-danger" disabled={busy} onClick={() => send("stop")}>
            Close positions and stop
          </button>
          <button type="button" className="linklike" onClick={() => setConfirm(false)}>
            Keep following
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setConfirm(true)}>
          Stop
        </button>
      )}
    </span>
  )
}

/** The panic control: always here, never in a menu (docs/05 §3). */
export function PanicControls({ on, flatten }: { on: boolean; flatten: boolean }) {
  const [busy, setBusy] = useState(false)
  const send = async (action: "stop" | "flatten" | "off") => {
    setBusy(true)
    await fetch("/api/panic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) })
    window.location.reload()
  }
  return (
    <div className={`panic ${on ? "panic-on" : ""}`}>
      <div>
        <p className="panic-title">{on ? (flatten ? "Everything is being closed" : "All copying is stopped") : "Emergency stop"}</p>
        <p className="panic-note">
          {on
            ? "Nothing new will be opened for any follow. Exits still run."
            : "Stop opening new positions for every follow at once, or close everything now."}
        </p>
      </div>
      <div className="controls">
        {on ? (
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => send("off")}>
            Resume copying
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-quiet btn-danger" disabled={busy} onClick={() => send("stop")}>
              Stop opening
            </button>
            <button type="button" className="btn btn-quiet btn-danger" disabled={busy} onClick={() => send("flatten")}>
              Close everything
            </button>
          </>
        )}
      </div>
    </div>
  )
}
