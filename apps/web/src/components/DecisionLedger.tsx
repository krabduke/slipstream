/**
 * The decision ledger — the signature surface of this product.
 *
 * Every competing copy-trading tool shows you fills and hides what it declined.
 * That is backwards. A well-configured Slipstream SKIPS a lot: when the price
 * has already run past the leader's own fill, copying it means taking the other
 * side of their trade. Refusing is the product working.
 *
 * So a skip renders LOUDER than a fill here: it carries the blocking number at
 * display size, in amber (held, not failed). A fill states itself quietly.
 * That inversion is deliberate — it is what proves the engine is working when
 * it appears to be doing nothing.
 */

export type Verdict = "copied" | "exited" | "skipped"
export type Venue = "hyperliquid" | "polymarket"

export interface Decision {
  id: string
  at: string
  venue: Venue
  /** Human label: "BTC" on a perp, the question on a prediction market. */
  market: string
  verdict: Verdict
  /** What the leader did, in plain words. */
  leaderAction: string
  /** For copied/exited: what we actually did. */
  outcome?: string
  /** For skipped: the headline number that blocked it, e.g. "87 bps". */
  refusal?: string
  /** For skipped: one sentence naming the limit that fired. */
  because?: string
}

const VENUE_LABEL: Record<Venue, string> = {
  hyperliquid: "HL",
  polymarket: "PM",
}

export function DecisionLedger({ decisions }: { decisions: readonly Decision[] }) {
  if (decisions.length === 0) {
    return (
      <div className="ledger">
        <div className="row">
          <span className="row-time">—</span>
          <div className="row-body">
            <div className="row-market">No decisions yet</div>
            <div className="row-lead">
              Follow a trader and every decision the engine makes — including the
              ones where it declines — will appear here with the numbers behind it.
            </div>
          </div>
          <div />
        </div>
      </div>
    )
  }

  return (
    <div className="ledger">
      {decisions.map((d) => (
        <article key={d.id} className="row" data-verdict={d.verdict}>
          <time className="row-time num">{d.at}</time>

          <div className="row-body">
            <div className="row-head">
              <span className="row-venue">{VENUE_LABEL[d.venue]}</span>
              <h3 className="row-market">{d.market}</h3>
            </div>
            <p className="row-lead">{d.leaderAction}</p>
          </div>

          <div className="row-verdict">
            {d.verdict === "skipped" ? (
              <>
                <span className="row-refusal num">{d.refusal}</span>
                <span className="row-because">{d.because}</span>
              </>
            ) : (
              <span className="row-amount num">{d.outcome}</span>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}
