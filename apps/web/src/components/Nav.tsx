import Link from "next/link"
import { Mark } from "./Mark"
import { NavLinks } from "./NavLinks"
import { WalletButton } from "./WalletButton"

/** The header, in K2's arrangement: lockup, section links, sign-in. The status band sits under it. */
export function Nav() {
  return (
    <header className="topbar">
      <nav className="nav" aria-label="Sections">
        <Link href="/" className="lockup" aria-label="Slipstream, home">
          <Mark />
          <span className="lockup-text">
            <span className="lockup-name">SLIPSTREAM</span>
            <span className="lockup-sub">K2 Capital</span>
          </span>
        </Link>
        <NavLinks />
        <WalletButton />
      </nav>
    </header>
  )
}
