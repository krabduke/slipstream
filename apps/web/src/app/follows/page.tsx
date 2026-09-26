import Link from "next/link"
import type { Metadata } from "next"
import { getKillState, listFollowPositions, listFollows } from "@slipstream/db/queries/index"
import type { UserId } from "@slipstream/shared"
import { FollowControls, PanicControls } from "@/components/FollowControls"
import { GoLive } from "@/components/LiveKeyControls"
import { SignInPrompt } from "@/components/SignInPrompt"
import { getDb } from "@/lib/db"
import { ago, pctSigned, shortAddress, signClass, usd, usdSigned, venueName } from "@/lib/format"
import { getSession, isLiveAllowed } from "@/lib/session"

export const metadata: Metadata = { title: "Following · Slipstream" }
export const dynamic = "force-dynamic"

const sizingText = (mode: string, param: string) => {
  const v = Number(param)
  if (mode === "fixed_notional") return `${usd(v)} per position`
  if (mode === "percent_equity") return `${v}% of balance per position`
  return `${v}× their share of equity`
}

export default async function Follows() {
  const session = await getSession()
  if (!session) {
    return (
      <section className="section">
        <h1 className="section-title">Following</h1>
        <SignInPrompt what="see and manage the traders you follow" />
      </section>
    )
  }
  const db = getDb()
  const uid = session.userId as UserId
  const follows = await listFollows(uid, db)
  const [positions, kill] = await Promise.all([
    listFollowPositions(uid, db, follows.map((f) => f.id)),
    getKillState(uid, db, follows.map((f) => f.id)),
  ])

  return (
    <>
      <section className="section">
        <h1 className="section-title">Following</h1>
        <p className="section-note">
          Every follow runs in paper against live order books. Pausing stops new positions and keeps following the leader out
          of the ones already open.
        </p>
      </section>

      <section className="section">
        <PanicControls on={kill.panic} flatten={kill.panicFlatten} />
      </section>

      <section className="section">
        {follows.length === 0 ? (
          <p className="empty">
            You aren&rsquo;t following anyone yet. Pick a wallet on <Link href="/traders">Traders</Link> and start a paper follow.
          </p>
        ) : (
          <div className="follow-list">
            {follows.map((f) => {
              const start = Number(f.startingEquity ?? 0)
              const eq = f.equity === null ? null : Number(f.equity)
              const change = eq === null ? null : eq - start
              const mine = positions.filter((p) => p.subscriptionId === f.id)
              const paused = kill.paused.has(f.id)
              return (
                <article key={f.id} className="follow-card" data-paused={paused}>
                  <header className="follow-card-head">
                    <div>
                      <Link className="who-name" href={`/traders/${f.venue}/${f.leaderAddress}`}>
                        {f.leaderLabel ?? shortAddress(f.leaderAddress)}
                      </Link>
                      <p className="dim small">
                        {venueName(f.venue)} · {f.isPaper ? "Paper" : "Live"} · {sizingText(f.sizingMode, f.sizingParam)}
                        {paused ? " · Paused" : ""}
                      </p>
                    </div>
                    <span className="controls">
                      {isLiveAllowed(session.address) && f.venue === "hyperliquid" ? <GoLive id={f.id} live={!f.isPaper} /> : null}
                      <FollowControls id={f.id} paused={paused} stopping={kill.stopping.has(f.id)} />
                    </span>
                  </header>
                  {!f.isPaper ? (
                    <p className="verdict verdict-live">
                      Live: orders are placed on your Hyperliquid account with your trade-only key. Balance and positions are
                      your real account&rsquo;s; see them on Hyperliquid or in Activity.
                    </p>
                  ) : (
                  <dl className="stat-grid">
                    <div><dt>Balance</dt><dd className="num">{usd(eq)}</dd></div>
                    <div><dt>Since start</dt><dd className={`num ${signClass(change)}`}>{usdSigned(change)} <span className="dim">{pctSigned(change === null || !start ? null : change / start, 1)}</span></dd></div>
                    <div><dt>Realised</dt><dd className={`num ${signClass(Number(f.realizedPnl))}`}>{usdSigned(Number(f.realizedPnl ?? 0))}</dd></div>
                    <div><dt>Fees</dt><dd className="num">{usd(Number(f.feesPaid ?? 0))}</dd></div>
                  </dl>
                  )}
                  {!f.isPaper ? null : mine.length ? (
                    <div className="table-wrap">
                      <table className="plain">
                        <thead>
                          <tr><th scope="col">Position</th><th scope="col">Side</th><th scope="col" className="r">Size</th><th scope="col" className="r">Entry</th></tr>
                        </thead>
                        <tbody>
                          {mine.map((p) => (
                            <tr key={p.marketId}>
                              <td>{p.label ?? p.marketId}</td>
                              <td className={p.side === "long" ? "sig-long" : "sig-short"}>{p.side}</td>
                              <td className="r num">{+Number(p.size).toPrecision(6)}</td>
                              <td className="r num">{+Number(p.entryPrice).toPrecision(6)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="dim small">No open positions. New moves by this trader will be copied as they happen.</p>
                  )}
                  <p className="dim small">Balance updated {f.equityAt ? ago(f.equityAt) : "when the engine next runs"}.</p>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}
