import type { JSX } from 'react'

// Every agent's name, color and icon, in one place. The activity drawer and
// agent panels read from here, so a new agent only needs an entry below.

export interface AgentInfo {
  name: string
  color: string // solid: icon background, accents
  soft: string // tint: panel backgrounds
  Icon: () => JSX.Element
}

function WandIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m4 20 11-11" />
      <path d="m13 7 4 4" />
      <path d="M18 3v3M16.5 4.5h3M20 9v2M19 10h2M9 3v2M8 4h2" />
    </svg>
  )
}

function AskIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 12a8 7.5 0 0 1-11.4 6.8L4 20l1.3-3.8A7.2 7.2 0 0 1 4 12a8 7.5 0 0 1 16 0Z" />
      <path d="M9.8 9.6a2.3 2.3 0 0 1 4.4.9c0 1.5-2.2 1.8-2.2 3" />
      <path d="M12 16h.01" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      <path d="M16 4.5v2M15 5.5h2" />
    </svg>
  )
}

function FlowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="5" cy="12" r="2.2" />
      <circle cx="19" cy="6" r="2.2" />
      <circle cx="19" cy="18" r="2.2" />
      <path d="M7.2 12h4.3M11.5 12 16.8 6.6M11.5 12l5.3 5.4" />
    </svg>
  )
}

function DotIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  )
}

export const AGENTS: Record<string, AgentInfo> = {
  setup_agent: { name: 'Setup agent', color: '#0f9d94', soft: '#ddf4f1', Icon: WandIcon },
  caretaker_helper: { name: 'Ask Tended', color: '#4f7bff', soft: '#e8eeff', Icon: AskIcon },
  watchdog: { name: 'Watchdog', color: '#e8590c', soft: '#fdebdd', Icon: EyeIcon },
  daily_summary: { name: 'Daily summary', color: '#c2417f', soft: '#fbe4ef', Icon: MoonIcon },
  coordinator: { name: 'Coordinator', color: '#16181d', soft: '#e2e5ea', Icon: FlowIcon },
}

export function agentInfo(key: string): AgentInfo {
  return AGENTS[key] ?? { name: key.replace(/_/g, ' '), color: '#5b6170', soft: '#eef0f3', Icon: DotIcon }
}

export function AgentBadge({ agent, size = 32 }: { agent: string; size?: number }) {
  const a = agentInfo(agent)
  return (
    <span className="agent-badge" style={{ background: a.color, width: size, height: size }} title={a.name}>
      <a.Icon />
    </span>
  )
}
