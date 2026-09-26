import "server-only"
import { unstable_cache } from "next/cache"
import { getTraderProfile, latestIntelRuns, listTraders, type TraderSort } from "@slipstream/db/queries/intel"
import type { TraderProfile } from "@slipstream/intel/types"
import { getDb } from "./db"

export type TraderListRow = Omit<Awaited<ReturnType<typeof listTraders>>[number], "refreshedAt" | "scoreParts"> & {
  refreshedAt: string
  scoreParts: TraderProfile["scoreParts"] | null
}

/** The engine refreshes every 6 hours, so five minutes of caching costs nothing. */
export const getTraderList = unstable_cache(
  async (venue: string | null, copyableOnly: boolean, sort: TraderSort, limit: number): Promise<TraderListRow[]> => {
    const rows = await listTraders(getDb(), { venue: venue ?? undefined, copyableOnly, sort, limit })
    return rows.map((r) => ({
      ...r,
      refreshedAt: r.refreshedAt.toISOString(),
      scoreParts: (r.scoreParts as TraderProfile["scoreParts"] | null) ?? null,
    }))
  },
  ["trader-list-v1"],
  { revalidate: 300 },
)

export const getProfile = unstable_cache(
  async (venue: string, address: string) => {
    const row = await getTraderProfile(getDb(), venue, address)
    return row ? { profile: row.profile as unknown as TraderProfile, refreshedAt: row.refreshedAt.toISOString() } : null
  },
  ["trader-profile-v1"],
  { revalidate: 300 },
)

export const getIntelFreshness = unstable_cache(
  async () => {
    const r = await latestIntelRuns(getDb())
    return r.map((x) => ({
      venue: x.venue,
      finishedAt: new Date(x.finished_at).toISOString(),
    }))
  },
  ["intel-freshness-v1"],
  { revalidate: 300 },
)
