import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import type { CopyFlag, TraderProfile } from "@slipstream/intel/types"
import { FollowPanel } from "@/components/FollowPanel"
import { PnlCurve } from "@/components/PnlCurve"
import { ScoreStrip } from "@/components/ScoreStrip"
import { FLAG_TEXT } from "@/lib/flags"
import { ago, duration, pct, pctSigned, shortAddress, signClass, usd, usdSigned, venueName } from "@/lib/format"
import { getProfile } from "@/lib/traders"

type Params = { venue: string; address: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { venue, address } = await params
  const r = await getProfile(venue, address)
  const name = r?.profile.displayName ?? shortAddress(address)
  return { title: `${name} on ${venueName(venue)} · Slipstream` }
}

/** The score in sentences, so nobody has to decode the strip to trust it. */
function reasons(p: TraderProfile): string[] {
  const out: string[] = []
  const windows = [p.pnl.week, p.pnl.month, p.pnl.all].filter((v): v is number => v !== null)
  const up = windows.filter((v) => v > 0).length
  if (windows.length) out.push(`Profitable in ${up} of ${windows.length} windows (week, month, all time).`)
  if (p.activeWeeks) out.push(`Up in ${p.profitableWeeks} of ${p.activeWeeks} active weeks.`)
  if (p.maxDrawdownPct !== null) {
    out.push(
      p.venue === "hyperliquid"
        ? `Worst fall from a peak: ${pct(p.maxDrawdownPct)} of equity, measured so deposits and withdrawals don't count.`
        : `Worst fall in cumulative realised profit: ${pct(p.maxDrawdownPct)} of the capital the wallet shows.`,
    )
  }
  out.push(
    p.venue === "hyperliquid"
      ? `${p.tradeCount.toLocaleString("en-US")} closed trades in the latest 2,000 fills.`
      : `${p.tradeCount.toLocaleString("en-US")} closed positions in the latest 500.`,
  )
  const scale = (0.6 + 0.4 * p.scoreParts.sample) * p.scoreParts.concentrationPenalty
  if (scale < 0.99) out.push(`Score scaled to ${pct(scale)} for thin evidence or concentrated profit.`)
  return out
}

export default async function TraderPage({ params }: { params: Promise<Params> }) {
  const { venue, address } = await params
  if (venue !== "hyperliquid" && venue !== "polymarket") notFound()
  const r = await getProfile(venue, address)
  if (!r) notFound()
  const p = r.profile
  const flags = p.flags.map((f) => ({ f, t: FLAG_TEXT[f as CopyFlag] })).filter((x) => x.t)
  const external =
    venue === "hyperliquid"
      ? `https://app.hyperliquid.xyz/explorer/address/${p.address}`
      : `https://polymarket.com/profile/${p.address}`

  return (
    <article className="profile">
      <p className="crumb">
        <Link href={`/traders?venue=${venue}`}>{venueName(venue)} traders</Link>
      </p>
      <header className="profile-head">
        <div>
          <h1 className="section-title">{p.displayName ?? shortAddress(p.address)}</h1>
          <p className="profile-id num">
            {p.address}{" "}
            <a href={external} target="_blank" rel="noreferrer">
              View on {venueName(venue)}
            </a>
          </p>
        </div>
        <ScoreStrip score={p.score} parts={p.scoreParts} size="hero" />
      </header>

      <section className={`verdict ${p.copyable ? "" : "verdict-held"}`}>
        {p.copyable ? (
          <p>Nothing structural stops this wallet from being copied. Whether it should be is your call.</p>
        ) : (
          <p>This wallet can&rsquo;t be copied in a way that would reproduce its results.</p>
        )}
        {flags.length ? (
          <ul className="flag-list">
            {flags.map(({ f, t }) => (
              <li key={f}>
                <span className={t!.blocking ? "flag flag-block" : "flag"}>{t!.label}</span> {t!.why}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <FollowPanel venue={venue} address={p.address} copyable={p.copyable} />

      <section className="section">
        <h2 className="h2">Why this score</h2>
        <ul className="reasons">
          {reasons(p).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>

      <section className="section stats">
        <dl className="stat-grid">
          <div><dt>Account value</dt><dd className="num">{usd(p.accountValue)}</dd></div>
          <div><dt>7 days</dt><dd className={`num ${signClass(p.pnl.week)}`}>{usdSigned(p.pnl.week)}</dd></div>
          <div><dt>30 days</dt><dd className={`num ${signClass(p.pnl.month)}`}>{usdSigned(p.pnl.month)}</dd></div>
          <div><dt>All time</dt><dd className={`num ${signClass(p.pnl.all)}`}>{usdSigned(p.pnl.all)}</dd></div>
          <div>
            <dt>{venue === "hyperliquid" ? "Return, all time" : "Profit per $ staked"}</dt>
            <dd className={`num ${signClass(p.roi.all)}`}>{pctSigned(p.roi.all, 1)}</dd>
          </div>
          <div><dt>Worst drawdown</dt><dd className="num">{pct(p.maxDrawdownPct)}</dd></div>
          <div><dt>Win rate</dt><dd className="num">{pct(p.winRate)}</dd></div>
          {venue === "hyperliquid" ? (
            <div><dt>Median hold</dt><dd className="num">{duration(p.medianHoldSecs)}</dd></div>
          ) : (
            <div><dt>Markets traded</dt><dd className="num">{p.marketsTraded ?? "—"}</dd></div>
          )}
        </dl>
      </section>

      <section className="section">
        <h2 className="h2">{venue === "hyperliquid" ? "Cumulative profit, all time" : "Cumulative realised profit, latest 500 positions"}</h2>
        <PnlCurve points={p.pnlCurve} />
      </section>

      <section className="section">
        <h2 className="h2">Open positions</h2>
        {p.openPositions.length === 0 ? (
          <p className="empty">No open positions right now.</p>
        ) : (
          <div className="table-wrap">
            <table className="plain">
              <thead>
                <tr>
                  <th scope="col">Market</th>
                  <th scope="col">Side</th>
                  <th scope="col" className="r">Entry</th>
                  <th scope="col" className="r">Mark</th>
                  <th scope="col" className="r">Value</th>
                  <th scope="col" className="r">Unrealised</th>
                  {venue === "hyperliquid" ? <th scope="col" className="r">Leverage</th> : null}
                </tr>
              </thead>
              <tbody>
                {p.openPositions.map((o, i) => (
                  <tr key={`${o.market}:${o.side}:${i}`}>
                    <td>{o.url ? <a href={o.url} target="_blank" rel="noreferrer">{o.market}</a> : o.market}</td>
                    <td className={o.side === "long" ? "sig-long" : o.side === "short" ? "sig-short" : ""}>{o.side}</td>
                    <td className="r num">{o.entryPrice ?? "—"}</td>
                    <td className="r num">{o.markPrice === null ? "—" : +o.markPrice.toPrecision(5)}</td>
                    <td className="r num">{usd(o.valueUsd)}</td>
                    <td className={`r num ${signClass(o.unrealizedPnl)}`}>{usdSigned(o.unrealizedPnl)}</td>
                    {venue === "hyperliquid" ? <td className="r num">{o.leverage ? `${o.leverage}×` : "—"}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <h2 className="h2">Recent activity</h2>
        {p.recentTrades.length === 0 ? (
          <p className="empty">No recent trades in the fetched window.</p>
        ) : (
          <div className="table-wrap">
            <table className="plain">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Market</th>
                  <th scope="col">Action</th>
                  <th scope="col" className="r">Size</th>
                  <th scope="col" className="r">Price</th>
                  <th scope="col" className="r">Profit</th>
                </tr>
              </thead>
              <tbody>
                {p.recentTrades.map((t, i) => (
                  <tr key={`${t.at}:${i}`}>
                    <td className="num dim">{ago(t.at)}</td>
                    <td>{t.market}</td>
                    <td>{t.action}</td>
                    <td className="r num">{+t.size.toPrecision(6)}</td>
                    <td className="r num">{+t.price.toPrecision(5)}</td>
                    <td className={`r num ${signClass(t.pnl)}`}>{t.pnl === null ? "—" : usdSigned(t.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="table-foot">Profiled {ago(r.refreshedAt)} from public {venueName(venue)} data. Statistics, not advice.</p>
    </article>
  )
}
