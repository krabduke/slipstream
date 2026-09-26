/** Display formatting. Every number rendered in this app goes through here. */

const compact = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`
  return a >= 100 ? n.toFixed(0) : n.toFixed(a >= 10 ? 1 : 2)
}

/** "$1.2M", or an em dash when unknown. */
export const usd = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n < 0 ? "−" : ""}$${compact(Math.abs(n))}`

/** Signed: "+$34k" / "−$2.1M". The sign carries meaning alongside colour. */
export const usdSigned = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}$${compact(Math.abs(n))}`

export const pct = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(digits)}%`

export const pctSigned = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined || !Number.isFinite(x)
    ? "—"
    : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toLocaleString("en-US", { maximumFractionDigits: digits })}%`

export const signClass = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) || n === 0 ? "" : n > 0 ? "sig-long" : "sig-short"

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function duration(secs: number | null | undefined): string {
  if (secs === null || secs === undefined || !Number.isFinite(secs)) return "—"
  if (secs < 60) return `${Math.round(secs)}s`
  if (secs < 3600) return `${Math.round(secs / 60)}m`
  if (secs < 86400) return `${(secs / 3600).toFixed(secs < 36000 ? 1 : 0)}h`
  return `${(secs / 86400).toFixed(secs < 864000 ? 1 : 0)}d`
}

export function ago(iso: string | Date | number): string {
  const t = typeof iso === "number" ? iso : new Date(iso).getTime()
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 90) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

export const venueName = (v: string) => (v === "hyperliquid" ? "Hyperliquid" : v === "polymarket" ? "Polymarket" : v)
