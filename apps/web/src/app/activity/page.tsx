import type { Metadata } from "next"
import { listDecisions } from "@slipstream/db/queries/index"
import type { UserId } from "@slipstream/shared"
import { DecisionLedger } from "@/components/DecisionLedger"
import { SignInPrompt } from "@/components/SignInPrompt"
import { getDb } from "@/lib/db"
import { toLedger } from "@/lib/ledger"
import { getSession } from "@/lib/session"

export const metadata: Metadata = { title: "Activity · Slipstream" }
export const dynamic = "force-dynamic"

export default async function Activity() {
  const session = await getSession()
  const rows = session ? await listDecisions(session.userId as UserId, getDb(), { limit: 200 }) : []
  return (
    <>
      <section className="section">
        <h1 className="section-title">Activity</h1>
        <p className="section-note">
          Every decision the engine makes for you, including the ones where it declines. A copy arrives after the trade it
          copies; when the price has already run past the leader&rsquo;s fill, Slipstream refuses and shows you the number.
          Refusals are the system working.
        </p>
      </section>
      <section className="section">
        {session ? <DecisionLedger decisions={toLedger(rows)} /> : <SignInPrompt what="see your activity" />}
      </section>
    </>
  )
}
