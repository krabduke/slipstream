import { DecisionLedger, type Decision } from "@/components/DecisionLedger"

/**
 * DESIGN PREVIEW — fixture data, not live.
 *
 * This route exists so the ledger's visual hierarchy can be reviewed before the
 * engine is built. It is explicitly labelled so it can never be mistaken for
 * real activity. Delete it once /api/decisions is live.
 */
const FIXTURES: Decision[] = [
  {
    id: "1",
    at: "14:02:11",
    venue: "hyperliquid",
    market: "BTC perp",
    verdict: "skipped",
    leaderAction: "0x7a3f… opened long 12.4 BTC at 64,210",
    refusal: "87 bps",
    because: "Price moved past the leader's fill by more than your 50 bps limit. Best ask was 64,769.",
  },
  {
    id: "2",
    at: "14:02:11",
    venue: "hyperliquid",
    market: "ETH perp",
    verdict: "copied",
    leaderAction: "0x7a3f… opened long 180 ETH at 3,142",
    outcome: "+0.61 ETH at 3,144",
  },
  {
    id: "3",
    at: "14:19:48",
    venue: "polymarket",
    market: "Fed cuts rates in September",
    verdict: "skipped",
    leaderAction: "0x91c2… bought 40,000 YES at 0.38",
    refusal: "0.61",
    because: "Book had moved to 0.61. Copying here would pay 23 cents more than the leader for the same outcome.",
  },
  {
    id: "4",
    at: "14:47:03",
    venue: "polymarket",
    market: "Fed cuts rates in September",
    verdict: "exited",
    leaderAction: "0x91c2… closed 40,000 YES at 0.71",
    outcome: "−128 YES at 0.706",
  },
  {
    id: "5",
    at: "15:31:20",
    venue: "hyperliquid",
    market: "SOL perp",
    verdict: "skipped",
    leaderAction: "0x7a3f… opened long 9,400 SOL at 178.40",
    refusal: "3.1× cap",
    because: "The copied position would have been 3.1 times your $1,000 per-position limit.",
  },
]

export default function Preview() {
  return (
    <>
      <section className="section">
        <p className="eyebrow">Design preview — fixture data, not live</p>
        <h1 className="section-title">Decision ledger</h1>
        <p className="section-note">
          Three of the five entries below are refusals, and they are the loudest
          things on the page. That is the intent: the number that blocked a copy
          is more useful to you than another green fill notification.
        </p>
      </section>
      <section className="section">
        <DecisionLedger decisions={FIXTURES} />
      </section>
    </>
  )
}
