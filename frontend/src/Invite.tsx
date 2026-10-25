import { useState } from 'react'
import type { Invite } from './api'

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false // e.g. no clipboard permission; the text is still selectable
  }
}

export const inviteMessage = (inv: Invite) =>
  `Hi ${inv.caretaker_name || 'there'}, I’m using Tended to keep track of ${inv.pet_name} while I’m away. Download it and use the code ${inv.code} to join.`

/** The code for the caretaker, a copy button and a ready-to-send message. */
export function InviteCard({ invite }: { invite: Invite }) {
  const [copied, setCopied] = useState<'code' | 'message' | null>(null)
  const message = inviteMessage(invite)
  const days = Math.max(1, Math.round((new Date(invite.expires_at).getTime() - Date.now()) / 86_400_000))
  const doCopy = async (what: 'code' | 'message') => {
    if (await copy(what === 'code' ? invite.code : message)) {
      setCopied(what)
      setTimeout(() => setCopied(null), 2000)
    }
  }
  return (
    <div className="invite-card">
      <p className="kicker">Invite code for {invite.caretaker_name || 'your caretaker'}</p>
      <div className="invite-code-row">
        <code className="invite-code">{invite.code}</code>
        <button type="button" className="btn primary small" onClick={() => doCopy('code')}>
          {copied === 'code' ? 'Copied ✓' : 'Copy code'}
        </button>
      </div>
      <p className="muted small">Works once, for {invite.pet_name} only, for the next {days} days.</p>
      <label className="field">
        <span>Message to send</span>
        <textarea readOnly rows={5} value={message} onFocus={(e) => e.target.select()} />
      </label>
      <button type="button" className="btn ghost small" onClick={() => doCopy('message')}>
        {copied === 'message' ? 'Copied ✓' : 'Copy message'}
      </button>
    </div>
  )
}
