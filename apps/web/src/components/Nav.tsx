import Link from "next/link"
import { WalletButton } from "./WalletButton"

/** Section navigation, under the status band (which stays a status strip). */
export function Nav() {
  return (
    <nav className="nav" aria-label="Sections">
      <div className="nav-links">
        <Link href="/">Overview</Link>
        <Link href="/traders">Traders</Link>
        <Link href="/follows">Following</Link>
        <Link href="/activity">Activity</Link>
        <Link href="/method">How scores work</Link>
        <Link href="/settings">Settings</Link>
      </div>
      <WalletButton />
    </nav>
  )
}
