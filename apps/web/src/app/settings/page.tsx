import type { Metadata } from "next"
import { findVenueAccountByOwner, getEncryptedKey, getRiskProfile } from "@slipstream/db/queries/index"
import type { UserId, VenueAccountId } from "@slipstream/shared"
import { ConnectHyperliquid } from "@/components/LiveKeyControls"
import { LimitsForm } from "@/components/LimitsForm"
import { fromRow } from "@/lib/limits"
import { SignInPrompt } from "@/components/SignInPrompt"
import { getDb } from "@/lib/db"
import { ago, shortAddress } from "@/lib/format"
import { getSession, isLiveAllowed } from "@/lib/session"

export const metadata: Metadata = { title: "Settings · Slipstream" }
export const dynamic = "force-dynamic"

export default async function Settings() {
  const session = await getSession()
  if (!session) {
    return (
      <section className="section">
        <h1 className="section-title">Settings</h1>
        <SignInPrompt what="manage settings" />
      </section>
    )
  }
  const uid = session.userId as UserId
  const db = getDb()
  const live = isLiveAllowed(session.address)
  const account = await findVenueAccountByOwner(uid, db, "hyperliquid", session.address)
  const key = account && account.status === "active" ? await getEncryptedKey(uid, db, account.id as VenueAccountId) : undefined

  return (
    <article className="prose">
      <h1 className="section-title">Settings</h1>
      <p>
        Signed in as <span className="num">{session.address}</span>.
      </p>

      <h2 className="h2">Risk limits</h2>
      <p>
        These apply to every follow, paper and live, and to any manual order. Lowering a limit takes effect at once;
        raising one asks your wallet to confirm. How far a copy may trail the leader&rsquo;s price is set per venue and not
        editable here.
      </p>
      <LimitsForm current={fromRow(await getRiskProfile(uid, db, null))} />

      <h2 className="h2">Live trading on Hyperliquid</h2>
      {!live ? (
        <p>
          Live copy trading is limited to the operator&rsquo;s own wallets for now. Everything else on Slipstream, including
          paper following, is open to you.
        </p>
      ) : (
        <>
          <p>
            Live trading uses a Hyperliquid <strong>agent key</strong>: it can place and cancel orders on your account, and
            it cannot withdraw or transfer funds. Your browser creates it, your wallet approves it on Hyperliquid, and it is
            sealed to the Slipstream engine before it leaves this page, so this website only ever stores ciphertext. The
            engine re-checks on Hyperliquid that the key is still your agent before every session.
          </p>
          <p>
            {key && account
              ? `Connected: agent ${shortAddress(account.signerAddress)}, stored ${ago(key.rotatedAt ?? key.createdAt)}.`
              : "Not connected."}
          </p>
          <ConnectHyperliquid address={session.address} connected={Boolean(key)} />
          <p className="dim small">
            To revoke the key on Hyperliquid itself, remove the &ldquo;slipstream&rdquo; API wallet in Hyperliquid&rsquo;s
            settings. Removing it here only deletes Slipstream&rsquo;s copy.
          </p>
        </>
      )}
    </article>
  )
}
