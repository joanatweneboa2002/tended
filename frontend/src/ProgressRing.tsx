// A ring: "x of y tasks done". Strong sky stroke on a pale track (both set in CSS).
export function ProgressRing({ done, total, size = 112 }: { done: number; total: number; size?: number }) {
  const stroke = Math.max(9, Math.round(size / 10))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = total ? done / total : 0
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${done} of ${total} tasks done`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ring-track)" strokeWidth={stroke} />
        {pct > 0 && <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--ring)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />}
      </svg>
      <span className="ring-label">
        <b>
          {done}
          <small>/{total}</small>
        </b>
        <span>done</span>
      </span>
    </div>
  )
}
