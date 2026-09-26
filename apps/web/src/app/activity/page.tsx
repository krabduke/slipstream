import { DecisionLedger } from "@/components/DecisionLedger"

/**
 * The dashboard. It renders the true empty state: no engine exists yet, so
 * there are no decisions and it says so, rather than showing sample data that
 * would look like the product working.
 */
export default function Dashboard() {
  return (
    <>
      <section className="section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Activity</p>
            <h1 className="section-title">Every decision, including the refusals</h1>
          </div>
        </div>
        <p className="section-note">
          Most copy-trading tools show you fills and hide what they declined. A
          well-configured Slipstream declines often — when the price has already
          run past the leader&rsquo;s own fill, copying it means taking the other side
          of their trade. Those skips appear here with the number that caused them.
        </p>
      </section>

      <section className="section">
        <DecisionLedger decisions={[]} />
      </section>
    </>
  )
}
