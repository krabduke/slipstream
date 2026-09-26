"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/traders", label: "Traders" },
  { href: "/follows", label: "Following" },
  { href: "/activity", label: "Activity" },
  { href: "/method", label: "How scores work" },
  { href: "/settings", label: "Settings" },
] as const

export function NavLinks() {
  const path = usePathname()
  return (
    <div className="nav-links">
      {LINKS.map(({ href, label }) => {
        const here = href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`)
        return (
          <Link key={href} href={href} aria-current={here ? "page" : undefined}>
            {label}
          </Link>
        )
      })}
    </div>
  )
}
