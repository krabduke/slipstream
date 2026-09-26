import { describe, expect, it } from "vitest"
import { toLedger, type DecisionRowLike } from "../ledger"

const row = (over: Partial<DecisionRowLike>): DecisionRowLike => ({
  id: "1",
  ts: "2026-09-26T13:44:00Z",
  venue: "hyperliquid",
  marketId: "ETH",
  verdict: "skipped",
  reasonCode: null,
  detail: {},
  leaderAddress: "0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00",
  leaderFillPrice: "2683.25",
  ...over,
})

describe("toLedger", () => {
  it("states a paper copy quietly, with size and price", () => {
    const [d] = toLedger([row({ verdict: "copied", detail: { mode: "paper", label: "ETH perp", side: "sell", size: "0.1863", avgPrice: "2682.395", realizedPnl: "0" } })])
    expect(d!.verdict).toBe("copied")
    expect(d!.outcome).toBe("Paper · Sold 0.1863 at 2,682.39")
    expect(d!.market).toBe("ETH perp")
  })

  it("names the limit and the number behind a refusal", () => {
    const [d] = toLedger([row({ reasonCode: "position_cap", detail: { resultingNotional: "9000.5", limitNotional: "1000" } })])
    expect(d!.refusal).toBe("$9.0k")
    expect(d!.because).toContain("$1.0k per-position limit")
  })

  it("summarises positions the leader held before the follow", () => {
    const [d] = toLedger([row({ marketId: "*", reasonCode: "signal_stale", detail: { markets: "BTC perp, SOL perp", problem: "Only new moves are copied." } })])
    expect([d!.refusal, d!.because]).toEqual(["Not chased", "Only new moves are copied."])
  })

  it("explains an exit and shows realised profit with its sign", () => {
    const [d] = toLedger([row({ verdict: "exited", detail: { mode: "paper", side: "buy", size: "0.1863", avgPrice: "2600", realizedPnl: "15.42", exitReason: "leader_closed" } })])
    expect(d!.leaderAction).toContain("followed out")
    expect(d!.outcome).toContain("+$15.4 realised")
  })

  it("renders a venue rejection as a refusal with the venue's reason", () => {
    const [d] = toLedger([row({ verdict: "rejected", reasonCode: "venue_rejected", detail: { problem: "Insufficient margin to place order." } })])
    expect([d!.verdict, d!.refusal, d!.because]).toEqual(["skipped", "Error", "Insufficient margin to place order."])
  })
})
