import type { Decision } from "@/components/DecisionLedger"
import { usd } from "./format"

/** One decisions row, as stored. */
export interface DecisionRowLike {
  id: string
  ts: Date | string
  venue: string
  marketId: string
  verdict: string
  reasonCode: string | null
  detail: unknown
  leaderAddress: string | null
  leaderFillPrice: string | null
}

const n = (x: unknown) => (typeof x === "string" || typeof x === "number" ? Number(x) : NaN)
const px = (x: unknown) => {
  const v = n(x)
  return Number.isFinite(v) ? (+v.toPrecision(6)).toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—"
}
const short = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "the leader")

/** The headline number and the sentence for each reason the engine declines. */
function refusal(code: string, d: Record<string, unknown>): { refusal: string; because: string } {
  switch (code) {
    case "signal_stale":
      if (d["markets"] !== undefined)
        return { refusal: "Not chased", because: String(d["problem"] ?? "Positions opened before you followed are not copied.") }
      return {
        refusal: `${Math.round(n(d["ageMs"]) / 1000)}s late`,
        because: `The leader's trade was older than your ${Math.round(n(d["limitMs"]) / 1000)}s limit by the time it could be copied.`,
      }
    case "slippage_exceeded":
      return {
        refusal: d["observedBps"] ? `${d["observedBps"]} bps` : "Price ran",
        because: `The price had already moved past the leader's fill of ${px(d["leaderFillPrice"])} by more than your ${d["limitBps"]} bps limit.`,
      }
    case "book_too_thin":
      return {
        refusal: "Thin book",
        because: String(d["problem"] ?? "Not enough liquidity near the price to fill this without moving it."),
      }
    case "position_cap":
      return { refusal: usd(n(d["resultingNotional"])), because: `That position would exceed your ${usd(n(d["limitNotional"]))} per-position limit.` }
    case "position_pct_equity_cap":
      return { refusal: usd(n(d["resultingNotional"])), because: `That position would exceed ${Math.round(n(d["maxPositionPctEquity"]) * 100)}% of your balance.` }
    case "exposure_cap":
      return { refusal: usd(n(d["resultingExposure"])), because: `Total exposure would pass your limit of ${usd(n(d["limitExposure"]))}.` }
    case "leverage_cap":
      return { refusal: "Leverage", because: `This would take the account past your ${d["limitLeverage"]}× leverage limit.` }
    case "daily_loss_limit":
      return { refusal: usd(n(d["lossToday"])), because: `Today's losses reached your daily limit of ${usd(n(d["lossLimit"]))}; no new positions until tomorrow (UTC).` }
    case "rate_budget_low":
      return { refusal: `${d["remaining"]} left`, because: "The venue's action budget for this account is nearly used; the rest is kept for exits." }
    case "kill_switch_global":
      return { refusal: "Halted", because: "Copying is halted for everyone by the operator. Exits still run." }
    case "kill_switch_user":
      return { refusal: "Stopped", because: "Your panic switch is on, so nothing new is opened. Exits still run." }
    case "kill_switch_subscription":
      return { refusal: "Paused", because: "This follow is paused, so nothing new is opened. Exits still run." }
    case "market_filtered":
      return { refusal: "Filtered", because: "This market is outside the follow's market list." }
    case "leader_equity_unavailable":
      return { refusal: "No equity", because: "The leader's account value could not be read, so the copy could not be sized safely." }
    case "follower_equity_unavailable":
      return { refusal: "No balance", because: "Your account value could not be read, so the copy could not be sized safely." }
    case "below_min_notional":
      return { refusal: "Too small", because: "At your size this copy rounds below the venue's minimum order." }
    case "market_not_open":
      return { refusal: "Closed", because: "The market isn't open for trading." }
    case "venue_rejected":
      return { refusal: "Error", because: String(d["problem"] ?? "The venue rejected the order.") }
    default:
      return { refusal: code.replaceAll("_", " "), because: "" }
  }
}

export function toLedger(rows: readonly DecisionRowLike[]): Decision[] {
  return rows.map((r) => {
    const d = (r.detail ?? {}) as Record<string, unknown>
    const label = String(d["label"] ?? r.marketId)
    const mode = d["mode"] === "live" ? "" : "Paper · "
    const at = new Date(r.ts).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    const leaderAt = r.leaderFillPrice ? ` at ${px(r.leaderFillPrice)}` : ""
    const base = {
      id: r.id,
      at,
      venue: (r.venue === "polymarket" ? "polymarket" : "hyperliquid") as Decision["venue"],
      market: label,
    }
    if (r.verdict === "copied" || r.verdict === "exited") {
      const side = d["side"] === "buy" ? "Bought" : "Sold"
      const pnl = n(d["realizedPnl"])
      const pnlText = Number.isFinite(pnl) && pnl !== 0 ? `, ${pnl > 0 ? "+" : "−"}${usd(Math.abs(pnl))} realised` : ""
      const why =
        r.verdict === "exited"
          ? d["settled"]
            ? "Market resolved; position settled at the payout."
            : d["exitReason"] === "kill_switch_flatten"
              ? "Closed by your stop or panic switch."
              : `${short(r.leaderAddress)} reduced or closed; followed out (exits are never blocked).`
          : `${short(r.leaderAddress)} traded${leaderAt}.`
      return {
        ...base,
        verdict: r.verdict,
        leaderAction: why,
        outcome: `${mode}${side} ${px(d["size"])} at ${px(d["avgPrice"])}${pnlText}`,
      }
    }
    const { refusal: ref, because } = refusal(r.reasonCode ?? "", d)
    return {
      ...base,
      verdict: "skipped",
      leaderAction:
        r.marketId === "*"
          ? `${short(r.leaderAddress)} — ${String(d["markets"] ?? "").slice(0, 160)}`
          : `${mode}${short(r.leaderAddress)} traded${leaderAt}.`,
      refusal: ref,
      because,
    }
  })
}
