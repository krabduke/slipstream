/**
 * The annunciator band.
 *
 * Persistent, always visible, and it never renders a confident number it
 * cannot confirm. Borrowed from aircraft annunciator panels, where "held" and
 * "caution" states carry the same weight as normal ops — because in this
 * product the most important thing the engine does is often to decline.
 *
 * Two rules this component exists to enforce:
 *  - Stale or unknown data LOOKS stale. A dashboard confidently showing a
 *    five-minute-old position is worse than one admitting it doesn't know.
 *  - Paper mode is structural, not a badge. Mistaking paper for live is the
 *    catastrophic failure in this app, so it changes the chrome itself.
 */

export type LinkState = "ok" | "held" | "down" | "unknown"

export interface BandState {
  mode: "live" | "paper"
  /** null when the engine has never reported in. */
  engineHeartbeatSecs: number | null
  hyperliquid: LinkState
  polymarket: LinkState
  /** Exposure as a fraction of the configured cap, 0–1. null when unknown. */
  exposureRatio: number | null
  /** Remaining venue action budget, 0–1. null when unknown. */
  actionBudget: number | null
}

/**
 * Default is "nothing is connected", because right now that is true — the
 * engine and its API do not exist yet. Rendering plausible placeholder numbers
 * here would be the exact failure this component is designed to prevent.
 */
const DISCONNECTED: BandState = {
  mode: "paper",
  engineHeartbeatSecs: null,
  hyperliquid: "unknown",
  polymarket: "unknown",
  exposureRatio: null,
  actionBudget: null,
}

const LAMP_CLASS: Record<LinkState, string> = {
  ok: "lamp lamp-ok",
  held: "lamp lamp-held",
  down: "lamp lamp-down",
  unknown: "lamp lamp-idle",
}

const LAMP_LABEL: Record<LinkState, string> = {
  ok: "live",
  held: "held",
  down: "down",
  unknown: "no link",
}

const heartbeatLabel = (secs: number | null): { text: string; state: LinkState } => {
  if (secs === null) return { text: "no signal", state: "unknown" }
  if (secs < 30) return { text: `${secs}s ago`, state: "ok" }
  if (secs < 120) return { text: `${secs}s ago`, state: "held" }
  return { text: `${Math.floor(secs / 60)}m ago`, state: "down" }
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`)

export function AnnunciatorBand({ state = DISCONNECTED }: { state?: BandState }) {
  const beat = heartbeatLabel(state.engineHeartbeatSecs)

  return (
    <div className="band" data-mode={state.mode} role="status" aria-label="System status">
      <div className="band-mark">Slipstream</div>

      <div className="cell">
        <span className="cell-k">Engine</span>
        <span className={`cell-v ${LAMP_CLASS[beat.state]}`}>{beat.text}</span>
      </div>

      <div className="cell">
        <span className="cell-k">Hyperliquid</span>
        <span className={`cell-v ${LAMP_CLASS[state.hyperliquid]}`}>
          {LAMP_LABEL[state.hyperliquid]}
        </span>
      </div>

      <div className="cell">
        <span className="cell-k">Polymarket</span>
        <span className={`cell-v ${LAMP_CLASS[state.polymarket]}`}>
          {LAMP_LABEL[state.polymarket]}
        </span>
      </div>

      <div className="cell">
        <span className="cell-k">Exposure</span>
        <span className="cell-v num" aria-label={`Exposure ${pct(state.exposureRatio)} of cap`}>
          {pct(state.exposureRatio)}
          {state.exposureRatio !== null && (
            <span
              className={`meter ${state.exposureRatio > 0.8 ? "sig-held" : "sig-long"}`}
              style={{ display: "inline-block", marginLeft: "0.5rem", verticalAlign: "middle" }}
            >
              <span
                className="meter-fill"
                style={{ width: `${Math.min(100, state.exposureRatio * 100)}%` }}
              />
            </span>
          )}
        </span>
      </div>

      <div className="cell">
        <span className="cell-k">Actions left</span>
        <span className="cell-v num">{pct(state.actionBudget)}</span>
      </div>
    </div>
  )
}
