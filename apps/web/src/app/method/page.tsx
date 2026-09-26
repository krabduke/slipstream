import type { Metadata } from "next"
import type { CopyFlag } from "@slipstream/intel/types"
import { FLAG_TEXT } from "@/lib/flags"

export const metadata: Metadata = { title: "How scores work · Slipstream" }

export default function Method() {
  const flags = Object.entries(FLAG_TEXT) as [CopyFlag, (typeof FLAG_TEXT)[CopyFlag]][]
  return (
    <article className="prose">
      <h1 className="section-title">How scores work</h1>
      <p>
        Leaderboards rank by profit, which rewards size and luck. A $60M account that made 0.3% outranks a $50k account
        that doubled, and one lottery ticket outranks forty good weeks out of fifty. The Slipstream score asks a narrower
        question: how much evidence is there that this wallet is repeatably good, at a risk a follower could survive?
      </p>

      <h2 className="h2">The formula</h2>
      <p className="formula num">score = 100 × (0.40 profitability + 0.33 consistency + 0.27 risk) × evidence × concentration</p>
      <dl className="defs">
        <dt>Profitability</dt>
        <dd>
          Return with diminishing credit (a loss earns nothing, and credit saturates around +100%), plus the share of the
          week, month and all-time windows that were profitable. On Polymarket, return is realised profit per dollar staked.
        </dd>
        <dt>Consistency</dt>
        <dd>
          The share of active weeks that ended up. Fewer than eight weeks of history is only partly trusted, so a short hot
          streak cannot max it out.
        </dd>
        <dt>Risk</dt>
        <dd>
          The worst fall from a peak, scored from 1 at no drawdown to 0 at 90%. On Hyperliquid it is measured on a
          time-weighted return series so deposits and withdrawals cannot pass for gains or losses.
        </dd>
        <dt>Evidence</dt>
        <dd>
          A multiplier from 0.6 to 1.0 by the number of closed trades, reaching 1.0 at sixty. Seven lucky trades cap a
          score rather than nudging it.
        </dd>
        <dt>Concentration</dt>
        <dd>0.8 when one trade or market made over 40% of the profit, 0.6 when it made over 60%.</dd>
      </dl>
      <p>
        On each row the score strip shows the three parts in order of weight, and the part scaled away by evidence and
        concentration stays visible as the empty tail.
      </p>

      <h2 className="h2">Why a wallet can&rsquo;t be copied</h2>
      <dl className="defs">
        {flags.map(([k, v]) => (
          <div key={k}>
            <dt>
              <span className={v.blocking ? "flag flag-block" : "flag"}>{v.label}</span>
            </dt>
            <dd>{v.why}</dd>
          </div>
        ))}
      </dl>

      <h2 className="h2">Data and limits</h2>
      <p>
        Everything comes from the venues&rsquo; public APIs and is refreshed every six hours. Hyperliquid candidates are
        drawn from its full leaderboard (about 47,000 accounts) and profiled from their equity history, latest 2,000 fills
        and open positions. Polymarket candidates come from its all-time, monthly and weekly profit leaderboards and are
        profiled from their latest 500 closed positions and current positions. Polymarket publishes no account-value
        history, so its figures are labelled differently and are not directly comparable with Hyperliquid&rsquo;s.
      </p>
      <p>These are statistics, not advice. A wallet&rsquo;s past results say nothing certain about what it does next.</p>
    </article>
  )
}
