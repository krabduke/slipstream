/**
 * K2's mark — the peak as a line drawing with the blue surveyed point —
 * so Slipstream reads as part of the same house as k2capitalmanagement.xyz.
 */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M7 88 L33 47 L52 13 L67 41 L77 55 L93 88" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M52 13 L49 42 L43 64 L37 88" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" opacity="0.55" />
      <rect x="46" y="7" width="12" height="12" fill="#1f6dff" />
    </svg>
  )
}

export function ArrowRight() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
