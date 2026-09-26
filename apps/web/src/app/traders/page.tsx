import Link from "next/link"
import type { Metadata } from "next"
import type { TraderSort } from "@slipstream/db/queries/intel"
import { TraderTable } from "@/components/TraderTable"
import { ago, venueName } from "@/lib/format"
import { getIntelFreshness, getTraderList } from "@/lib/traders"

export const metadata: Metadata = {
  title: "Traders · Slipstream",
  description: "Hyperliquid and Polymarket wallets profiled from public data, with an honest score and the reasons a wallet can't be copied.",
}

const SORTS: { key: TraderSort; label: string }[] = [
  { key: "score", label: "Score" },
  { key: "pnl_month", label: "30-day profit" },
  { key: "pnl_all", label: "All-time profit" },
  { key: "account_value", label: "Size" },
]

type Search = { venue?: string; sort?: string; all?: string }

export default async function TradersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  // One venue at a time: their figures are measured differently (Polymarket has
  // no equity history), so a single ranking across both would mislead.
  const venue = sp.venue === "polymarket" ? "polymarket" : "hyperliquid"
  const sort = (SORTS.find((s) => s.key === sp.sort)?.key ?? "score") as TraderSort
  const copyableOnly = sp.all !== "1"
  const [rows, fresh] = await Promise.all([getTraderList(venue, copyableOnly, sort, 100), getIntelFreshness()])

  const q = (patch: Partial<Record<keyof Search, string | null>>) => {
    const next = { venue: venue === "hyperliquid" ? undefined : venue, sort: sort === "score" ? undefined : sort, all: copyableOnly ? undefined : "1", ...patch }
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v)
    const s = params.toString()
    return s ? `/traders?${s}` : "/traders"
  }

  return (
    <>
      <header className="page-head">
        <h1 className="section-title">Traders</h1>
        <p className="section-note">
          The strongest wallets on each venue, profiled from public data every six hours. The score asks how
          much evidence there is of repeatable skill at a survivable risk — not who made the most. Hover a note to see why a
          wallet can&rsquo;t be copied.
        </p>
        <p className="fresh">
          {fresh.length
            ? fresh.map((f) => `${venueName(f.venue)} refreshed ${ago(f.finishedAt)}`).join("; ")
            : "No refresh has finished yet."}
        </p>
      </header>

      <div className="filters" role="group" aria-label="Filters">
        <div className="seg-group" aria-label="Venue">
          <Link className="seg-btn" aria-current={venue === "hyperliquid" ? "true" : undefined} href={q({ venue: null })}>Hyperliquid</Link>
          <Link className="seg-btn" aria-current={venue === "polymarket" ? "true" : undefined} href={q({ venue: "polymarket" })}>Polymarket</Link>
        </div>
        <div className="seg-group" aria-label="Sort by">
          {SORTS.map((s) => (
            <Link key={s.key} className="seg-btn" aria-current={sort === s.key ? "true" : undefined} href={q({ sort: s.key })}>
              {s.label}
            </Link>
          ))}
        </div>
        <Link className="toggle" href={q({ all: copyableOnly ? "1" : null })} aria-pressed={copyableOnly}>
          {copyableOnly ? "Showing copyable wallets only" : "Showing every profiled wallet"}
        </Link>
      </div>

      <TraderTable rows={rows} showVenue={false} />
    </>
  )
}
