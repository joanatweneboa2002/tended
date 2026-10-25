import type { JSX } from 'react'

// Small, friendly line icons (original SVGs) and the colored circle they sit in.

export type IconName =
  | 'bowl'
  | 'pill'
  | 'scale'
  | 'drop'
  | 'calendar'
  | 'paw'
  | 'heartPulse'
  | 'chat'
  | 'walk'
  | 'sparkle'
  | 'clipboard'
  | 'camera'
  | 'moon'
  | 'check'

// Tones: each section's accent. Dark icons on light accents, white on dark ones
// (all >= 3:1 against the circle, so the icon is easy to see).
export type Tone = 'coral' | 'yellow' | 'mint' | 'violet' | 'blue' | 'pink' | 'amber' | 'gray' | 'red'

const S = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

const PATHS: Record<IconName, JSX.Element> = {
  bowl: (
    <>
      <path d="M3.5 11.5h17a8.5 7 0 0 1-17 0Z" />
      <path d="M8 8.5c0-1.2 1-1.4 1-2.6M12 8.5c0-1.2 1-1.4 1-2.6M16 8.5c0-1.2 1-1.4 1-2.6" />
      <path d="M8 20h8" />
    </>
  ),
  pill: (
    <>
      <rect x="3.2" y="8.3" width="17.6" height="7.4" rx="3.7" transform="rotate(-38 12 12)" />
      <path d="m9.6 9.2 4.8 5.6" />
    </>
  ),
  scale: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="4" />
      <path d="M8.2 9.5a5 5 0 0 1 7.6 0" />
      <path d="m12 10.5 1.3-2" />
    </>
  ),
  drop: <path d="M12 3.5s6 6.4 6 10.6a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5Z" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <circle cx="12" cy="14.5" r="1.4" />
    </>
  ),
  paw: (
    <g fill="currentColor" stroke="none">
      <path d="M12 12.2c-3 0-6.3 3.6-6.3 6.5 0 2 1.6 3 3.3 3 1.2 0 2-.6 3-.6s1.8.6 3 .6c1.7 0 3.3-1 3.3-3 0-2.9-3.3-6.5-6.3-6.5Z" />
      <ellipse cx="5" cy="10.7" rx="2" ry="2.5" transform="rotate(-18 5 10.7)" />
      <ellipse cx="9.2" cy="6.3" rx="2.1" ry="2.7" transform="rotate(-6 9.2 6.3)" />
      <ellipse cx="14.8" cy="6.3" rx="2.1" ry="2.7" transform="rotate(6 14.8 6.3)" />
      <ellipse cx="19" cy="10.7" rx="2" ry="2.5" transform="rotate(18 19 10.7)" />
    </g>
  ),
  heartPulse: (
    <>
      <path d="M12 20.5S3.5 15.3 3.5 9.2A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8.5 2.6c0 6.1-8.5 11.3-8.5 11.3Z" />
      <path d="M6.5 12h2.8l1.3-2.6 2.2 4.8 1.4-2.2h3.3" />
    </>
  ),
  chat: <path d="M20 12a8 7.5 0 0 1-11.4 6.8L4 20l1.3-3.8A7.2 7.2 0 0 1 4 12a8 7.5 0 0 1 16 0Z" />,
  walk: (
    <>
      <circle cx="13" cy="4.5" r="1.8" />
      <path d="m9.5 21 2.5-6 2.5 2v4M8 12l2.5-4 3.5 1 2 3 2.5.5" />
      <path d="m12 8-1.5 6" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5 13.8 9 19.5 10.5 13.8 12.2 12 18 10.2 12.2 4.5 10.5 10.2 9Z" />
      <path d="M18.5 16.5v3M17 18h3" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="16" rx="3" />
      <path d="M9 4.5h6v2.5H9z" />
      <path d="m8.8 13 2.2 2.2 4.2-4.4" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5h3l1.5-2.5h7L17 8.5h3v10H4z" />
      <circle cx="12" cy="13.3" r="3.3" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
}

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg {...S} width={size} height={size}>
      {PATHS[name]}
    </svg>
  )
}

export function IconCircle({ name, tone, size = 42 }: { name: IconName; tone: Tone; size?: number }) {
  return (
    <span className={`icon-circle tone-${tone}`} style={{ width: size, height: size }} aria-hidden>
      <Icon name={name} size={Math.round(size * 0.52)} />
    </span>
  )
}

/** Icon + tone for a schedule task type. */
export const TASK_LOOK: Record<string, { icon: IconName; tone: Tone }> = {
  feed: { icon: 'bowl', tone: 'yellow' },
  walk: { icon: 'walk', tone: 'mint' },
  meds: { icon: 'pill', tone: 'pink' },
  potty: { icon: 'paw', tone: 'blue' },
  other: { icon: 'sparkle', tone: 'gray' },
}

/** Icon for an alert topic. */
export const TOPIC_ICON: Record<string, IconName> = {
  eating: 'bowl',
  meds: 'pill',
  weight: 'scale',
  drinking: 'drop',
  appointment: 'calendar',
  other: 'paw',
}
