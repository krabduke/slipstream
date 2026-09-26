import Link from "next/link"

/** Section navigation, under the status band (which stays a status strip). */
export function Nav() {
  return (
    <nav className="nav" aria-label="Sections">
      <Link href="/">Overview</Link>
      <Link href="/traders">Traders</Link>
      <Link href="/method">How scores work</Link>
    </nav>
  )
}
