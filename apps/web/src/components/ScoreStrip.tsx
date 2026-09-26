import type { ScoreParts } from "@slipstream/intel/types"

/**
 * The score, taken apart. Three segments show what each part contributed
 * (profitability, consistency, risk, weighted 40/33/27); the whole strip is
 * then scaled by evidence and concentration, and the part that was scaled
 * away stays visible as an empty outline. A wallet with seven lucky trades
 * shows a short strip with a long empty tail — the discount is the point.
 */
const W = { profitability: 0.4, consistency: 0.33, risk: 0.27 }

export function ScoreStrip({ score, parts, size = "row" }: { score: number; parts: ScoreParts; size?: "row" | "hero" }) {
  const evidence = 0.6 + 0.4 * parts.sample
  const scale = evidence * parts.concentrationPenalty
  const segs = [
    { k: "Profitability", v: W.profitability * parts.profitability * scale, cls: "seg-a" },
    { k: "Consistency", v: W.consistency * parts.consistency * scale, cls: "seg-b" },
    { k: "Risk", v: W.risk * parts.risk * scale, cls: "seg-c" },
  ]
  const label =
    `Score ${score} of 100: profitability ${Math.round(parts.profitability * 100)}%, ` +
    `consistency ${Math.round(parts.consistency * 100)}%, risk ${Math.round(parts.risk * 100)}%, ` +
    `scaled by ${Math.round(scale * 100)}% for evidence and concentration`
  return (
    <span className={`strip strip-${size}`} role="img" aria-label={label}>
      <span className="strip-score num">{score}</span>
      <span className="strip-bar">
        {segs.map((s) => (
          <span key={s.k} className={`seg ${s.cls}`} style={{ width: `${s.v * 100}%` }} title={`${s.k} ${Math.round(s.v * 100)}`} />
        ))}
      </span>
    </span>
  )
}
