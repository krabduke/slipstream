import Link from "next/link"
import { ArrowRight } from "@/components/Mark"
import { TraderTable } from "@/components/TraderTable"
import { getTraderList } from "@/lib/traders"

export const revalidate = 300

export default async function Home() {
  const [hl, pm] = await Promise.all([
    getTraderList("hyperliquid", true, "score", 5),
    getTraderList("polymarket", true, "score", 5),
  ])
  return (
    <>
      <header className="page-head home-head">
        <p className="eyebrow">Trader intelligence for Hyperliquid and Polymarket</p>
        <h1 className="display">Find traders worth following.</h1>
        <p className="section-note">
          Slipstream profiles the strongest wallets on both venues every six hours and scores them on evidence of repeatable
          skill at a risk you could live with. Size and one lucky bet don&rsquo;t move the score; consistency, drawdown and
          sample size do. Wallets that can&rsquo;t be copied, like scalpers and market makers, are marked and explained.
        </p>
        <div className="cta-row">
          <Link href="/traders" className="cta">
            <span className="cta-cap">Browse traders</span>
            <span className="cta-tile"><ArrowRight /></span>
          </Link>
          <Link href="/method" className="cta cta-ghost">
            <span className="cta-cap">How scores work</span>
          </Link>
        </div>
      </header>

      <section className="section">
        <div className="section-head">
          <h2 className="h2">Hyperliquid</h2>
          <Link href="/traders?venue=hyperliquid">All Hyperliquid traders</Link>
        </div>
        <TraderTable rows={hl} showVenue={false} />
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="h2">Polymarket</h2>
          <Link href="/traders?venue=polymarket">All Polymarket traders</Link>
        </div>
        <TraderTable rows={pm} showVenue={false} />
      </section>

      <section className="section pitch">
        <div>
          <h2 className="h2">Copying, done honestly</h2>
          <p>
            A copy always arrives after the trade it copies. When the price has already run past the leader&rsquo;s fill,
            Slipstream declines and shows you the number, instead of buying the top for you. Every copy, exit and refusal is
            written to a ledger you can read.
          </p>
        </div>
        <div>
          <h2 className="h2">A key that can&rsquo;t withdraw</h2>
          <p>
            Copy trading runs on a Hyperliquid agent key: it can place trades and nothing else. Slipstream checks on-chain
            that a key is a trade-only agent before storing it, and refuses anything that could move your funds.
          </p>
        </div>
        <div>
          <h2 className="h2">Paper first</h2>
          <p>
            Every follow starts in paper mode, filling against the live order book with pessimistic assumptions. You see
            what following a wallet would have done before any money is involved.
          </p>
        </div>
      </section>
    </>
  )
}
