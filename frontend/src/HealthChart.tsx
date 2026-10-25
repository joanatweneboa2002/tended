import { useState } from 'react'
import { addDays, formatDate, type HealthLog } from './api'

// Appetite and energy over the last 7 days, as two small stacked rows on one
// shared day axis. They are different scales (none/some/normal vs
// low/normal/high), so each row keeps its own labels instead of sharing a
// dual axis. Days with several entries show the average; days with none
// leave a gap in the line.

const ROWS = [
  {
    key: 'appetite' as const,
    title: 'Appetite',
    color: 'var(--series-appetite)',
    levels: ['none', 'some', 'normal'],
    labels: ['None', 'Some', 'Normal'],
  },
  {
    key: 'energy' as const,
    title: 'Energy',
    color: 'var(--series-energy)',
    levels: ['low', 'normal', 'high'],
    labels: ['Low', 'Normal', 'High'],
  },
]

const W = 560
const ROW_H = 84
const GAP = 48
const LEFT = 64
const RIGHT = 14
const TOP = 30
const X_AXIS = 26
const H = TOP + ROW_H * 2 + GAP + X_AXIS

type DayPoint = { day: string; values: (number | null)[]; counts: number[] }

function dailyPoints(logs: HealthLog[], today: string): DayPoint[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  return days.map((day) => {
    const entries = logs.filter((l) => l.log_date === day)
    const values: (number | null)[] = []
    const counts: number[] = []
    for (const row of ROWS) {
      const nums = entries
        .map((e) => e[row.key])
        .filter((v): v is NonNullable<typeof v> => v != null)
        .map((v) => row.levels.indexOf(v))
      counts.push(nums.length)
      values.push(nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null)
    }
    return { day, values, counts }
  })
}

function describe(row: (typeof ROWS)[number], v: number | null): string {
  if (v == null) return 'not logged'
  const rounded = Math.round(v)
  const label = row.labels[rounded]
  return Number.isInteger(v) ? label : `about ${label.toLowerCase()} (avg)`
}

export function HealthChart({ logs, today }: { logs: HealthLog[]; today: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const points = dailyPoints(logs, today)
  const plotW = W - LEFT - RIGHT
  const x = (i: number) => LEFT + (plotW * i) / 6
  const rowTop = (r: number) => TOP + r * (ROW_H + GAP)
  const y = (r: number, v: number) => rowTop(r) + ROW_H - (ROW_H * v) / 2

  // Split each row into runs of consecutive logged days so gaps stay gaps.
  const segments = (r: number) => {
    const runs: { i: number; v: number }[][] = []
    let cur: { i: number; v: number }[] = []
    points.forEach((p, i) => {
      const v = p.values[r]
      if (v == null) {
        if (cur.length) runs.push(cur)
        cur = []
      } else cur.push({ i, v })
    })
    if (cur.length) runs.push(cur)
    return runs
  }

  const hovered = hover != null ? points[hover] : null
  const tipLeft = hover != null ? `${(x(hover) / W) * 100}%` : '0'

  return (
    <figure className="health-chart" aria-label="Appetite and energy, last 7 days">
      <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden>
          {ROWS.map((row, r) => (
            <g key={row.key}>
              {/* row title: ink text, color carried by the swatch */}
              <line x1={4} x2={18} y1={rowTop(r) - 19} y2={rowTop(r) - 19} stroke={row.color} strokeWidth={2.5} strokeLinecap="round" />
              <text x={24} y={rowTop(r) - 15} className="chart-title">{row.title}</text>
              {row.labels.map((label, lvl) => (
                <g key={label}>
                  <line x1={LEFT} x2={W - RIGHT} y1={y(r, lvl)} y2={y(r, lvl)} className="chart-grid" />
                  <text x={LEFT - 8} y={y(r, lvl) + 4} textAnchor="end" className="chart-axis">{label}</text>
                </g>
              ))}
              {segments(r).map((run, k) =>
                run.length > 1 ? (
                  <polyline
                    key={k}
                    points={run.map((p) => `${x(p.i)},${y(r, p.v)}`).join(' ')}
                    fill="none"
                    stroke={row.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ) : null,
              )}
              {points.map((p, i) =>
                p.values[r] == null ? null : (
                  <circle
                    key={i}
                    cx={x(i)}
                    cy={y(r, p.values[r]!)}
                    r={hover === i ? 5.5 : 4}
                    fill={row.color}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                ),
              )}
            </g>
          ))}

          {hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={TOP - 6} y2={TOP + ROW_H * 2 + GAP + 6} className="chart-crosshair" />
          )}

          {points.map((p, i) => (
            <text key={p.day} x={x(i)} y={H - 6} textAnchor="middle" className={`chart-axis ${p.day === today ? 'is-today' : ''}`}>
              {p.day === today ? 'Today' : formatDate(p.day, { weekday: 'short' })}
            </text>
          ))}

          {/* hit targets: one full-height column per day, wider than the marks */}
          {points.map((p, i) => (
            <rect
              key={p.day}
              x={x(i) - plotW / 12}
              y={0}
              width={plotW / 6}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onTouchStart={() => setHover(i)}
            />
          ))}
        </svg>

        {hovered && (
          <div className="chart-tip" style={{ left: tipLeft }} role="status">
            <strong>{formatDate(hovered.day, { weekday: 'long', month: 'short', day: 'numeric' })}</strong>
            {ROWS.map((row, r) => (
              <span key={row.key}>
                <i style={{ background: row.color }} /> {row.title}: {describe(row, hovered.values[r])}
              </span>
            ))}
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>Appetite and energy, last 7 days</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Appetite</th>
            <th>Energy</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}>
              <td>{formatDate(p.day)}</td>
              <td>{describe(ROWS[0], p.values[0])}</td>
              <td>{describe(ROWS[1], p.values[1])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
