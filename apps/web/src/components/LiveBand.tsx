"use client"
import { useEffect, useState } from "react"
import { AnnunciatorBand, type BandState } from "./AnnunciatorBand"

type Status = { engineHeartbeatSecs: number | null; copy: { errors: number } | null; mode: "live" | "paper" }

/**
 * The band, fed by the engine's real heartbeat. Until the first answer
 * arrives it shows the disconnected state — never a plausible guess.
 */
export function LiveBand() {
  const [state, setState] = useState<BandState | undefined>(undefined)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const s = (await (await fetch("/api/status")).json()) as Status
        if (!alive) return
        const beat = s.engineHeartbeatSecs
        const link = beat === null ? "unknown" : beat > 120 ? "down" : s.copy && s.copy.errors > 0 ? "held" : "ok"
        setState({
          mode: s.mode,
          engineHeartbeatSecs: beat,
          hyperliquid: link,
          polymarket: link,
          exposureRatio: null,
          actionBudget: null,
        })
      } catch {
        if (alive) setState(undefined)
      }
    }
    void load()
    const t = setInterval(load, 15_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])
  return <AnnunciatorBand state={state} />
}
