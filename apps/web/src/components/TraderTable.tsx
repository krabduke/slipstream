import Link from "next/link"
import type { CopyFlag } from "@slipstream/intel/types"
import { FLAG_TEXT } from "@/lib/flags"
import { pct, pctSigned, shortAddress, signClass, usdSigned, venueName } from "@/lib/format"
import type { TraderListRow } from "@/lib/traders"
import { ScoreStrip } from "./ScoreStrip"

export function TraderTable({ rows, showVenue = true }: { rows: TraderListRow[]; showVenue?: boolean }) {
  if (!rows.length) {
    return (
      <p className="empty">
        No profiles match. The first refresh after a deploy takes about an hour; try again shortly, or widen the filters.
      </p>
    )
  }
  return (
    <div className="table-wrap">
      <table className="traders">
        <thead>
          <tr>
            <th scope="col">Trader</th>
            <th scope="col">Score</th>
            <th scope="col" className="r">30 days</th>
            <th scope="col" className="r">All time</th>
            <th scope="col" className="r" title="Hyperliquid: all-time return on equity. Polymarket: realised profit per dollar staked.">
              Return
            </th>
            <th scope="col" className="r">Worst drawdown</th>
            <th scope="col" className="r">Win rate</th>
            <th scope="col" className="r">Trades</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const href = `/traders/${r.venue}/${r.address}`
            return (
              <tr key={`${r.venue}:${r.address}`} data-copyable={r.copyable}>
                <td className="who">
                  <Link href={href} className="who-link">
                    {r.displayName ? <span className="who-name">{r.displayName}</span> : null}
                    <span className="who-addr num">{shortAddress(r.address)}</span>
                  </Link>
                  {showVenue ? <span className="venue-tag">{venueName(r.venue)}</span> : null}
                </td>
                <td>{r.scoreParts ? <ScoreStrip score={r.score} parts={r.scoreParts} /> : <span className="num">{r.score}</span>}</td>
                <td className={`r num ${signClass(r.pnlMonth)}`}>{usdSigned(r.pnlMonth)}</td>
                <td className={`r num ${signClass(r.pnlAll)}`}>{usdSigned(r.pnlAll)}</td>
                <td className={`r num ${signClass(r.roiAll)}`}>{pctSigned(r.roiAll)}</td>
                <td className="r num">{pct(r.maxDrawdown)}</td>
                <td className="r num">{pct(r.winRate)}</td>
                <td className="r num">{r.tradeCount.toLocaleString("en-US")}</td>
                <td className="notes">
                  {r.flags.length === 0 ? (
                    <span className="note-none">—</span>
                  ) : (
                    r.flags.map((f) => {
                      const t = FLAG_TEXT[f as CopyFlag]
                      return t ? (
                        <span key={f} className={t.blocking ? "flag flag-block" : "flag"} title={t.why}>
                          {t.label}
                        </span>
                      ) : null
                    })
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="table-foot">Statistics from public data, not advice. Past results say nothing certain about what a wallet does next.</p>
    </div>
  )
}
