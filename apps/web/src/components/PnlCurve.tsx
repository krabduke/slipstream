/**
 * Cumulative PnL as an SVG line, server-rendered, no chart library. The zero
 * line is drawn because which side of it the curve lives on is the point.
 * Colour follows the signal rule: the line takes the sign of the last value.
 */
export function PnlCurve({ points, height = 180 }: { points: readonly (readonly [number, number])[]; height?: number }) {
  if (points.length < 2) {
    return <p className="empty">Not enough history to draw a curve.</p>
  }
  const W = 720
  const H = height
  const pad = 6
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(0, ...ys)
  const y1 = Math.max(0, ...ys)
  const sx = (x: number) => pad + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * pad)
  const sy = (y: number) => H - pad - ((y - y0) / (y1 - y0 || 1)) * (H - 2 * pad)
  const d = points.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("")
  const last = ys[ys.length - 1]!
  const fmt = (t: number) => new Date(t).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
  return (
    <figure className="curve">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Cumulative PnL over time">
        <line x1={pad} x2={W - pad} y1={sy(0)} y2={sy(0)} className="curve-zero" />
        <path d={d} className={`curve-line ${last >= 0 ? "sig-long" : "sig-short"}`} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="curve-axis num">
        <span>{fmt(x0)}</span>
        <span>{fmt(x1)}</span>
      </figcaption>
    </figure>
  )
}
