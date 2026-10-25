import type { CSSProperties } from 'react'

// Small decorative SVGs. Purely visual, hidden from screen readers.

/** A paw print: one rounded pad and four toe beans. */
export function PawDoodle({ size = 28, rotate = 0, className = '', style }: { size?: number; rotate?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg
      className={`paw-doodle ${className}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      style={{ transform: `rotate(${rotate}deg)`, ...style }}
    >
      <g fill="currentColor">
        <path d="M16 15.2c-3.9 0-8.2 4.6-8.2 8.4 0 2.6 2 3.9 4.3 3.9 1.5 0 2.6-.8 3.9-.8s2.4.8 3.9.8c2.3 0 4.3-1.3 4.3-3.9 0-3.8-4.3-8.4-8.2-8.4Z" />
        <ellipse cx="6.6" cy="13.6" rx="2.6" ry="3.3" transform="rotate(-18 6.6 13.6)" />
        <ellipse cx="12.1" cy="7.9" rx="2.7" ry="3.5" transform="rotate(-6 12.1 7.9)" />
        <ellipse cx="19.9" cy="7.9" rx="2.7" ry="3.5" transform="rotate(6 19.9 7.9)" />
        <ellipse cx="25.4" cy="13.6" rx="2.6" ry="3.3" transform="rotate(18 25.4 13.6)" />
      </g>
    </svg>
  )
}

/** A soft wavy blob that sits behind the dashboard greeting. */
export function GreetBlob() {
  return (
    <svg className="greet-blob" viewBox="0 0 400 220" preserveAspectRatio="none" aria-hidden>
      <path
        fill="currentColor"
        d="M0 0h400v118c-22 30-58 52-104 46-40-5-60-34-102-30-43 4-62 46-110 52C47 191 17 172 0 150Z"
      />
      <path
        fill="currentColor"
        opacity=".45"
        d="M0 150c17 22 47 41 84 36 48-6 67-48 110-52 42-4 62 25 102 30 46 6 82-16 104-46v24c-26 32-62 52-108 46-40-5-58-30-98-27-42 3-64 44-112 50-38 4-66-14-82-34Z"
      />
    </svg>
  )
}

/** Soft wave + blobs layered over the header gradient. */
export function HeaderBlobs() {
  return (
    <svg className="header-blobs" viewBox="0 0 1200 300" preserveAspectRatio="none" aria-hidden>
      <path fill="#1b1460" opacity=".16" d="M0 210c140-40 260 20 400-10s230-110 380-90 250 90 420 50v140H0Z" />
      <path fill="#1b1460" opacity=".14" d="M0 250c180-30 300 30 470 5s260-80 420-60 220 70 310 50v55H0Z" />
      <circle cx="1080" cy="40" r="120" fill="#ffffff" opacity=".07" />
      <circle cx="140" cy="-30" r="110" fill="#ffffff" opacity=".06" />
    </svg>
  )
}
