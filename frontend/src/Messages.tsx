import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { api, type Message, type Pet, type Role } from './api'
import { AskTendedButton } from './AskTended'
import { dayIn, timeIn, viewerTz } from './time'

const POLL_MS = 4000

export function Messages({ pet, role, onRead }: { pet: Pet; role: Role; onRead: () => void }) {
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const lastId = useRef(0)
  const tz = viewerTz(pet, role)

  const load = useCallback(async () => {
    try {
      const list = await api.messages(pet.id)
      setMessages(list)
      setError(null)
      const newest = list.at(-1)?.id ?? 0
      if (list.some((m) => m.sender_role !== role && !m.read_at)) {
        await api.markRead(pet.id, role)
        onRead()
      }
      if (newest !== lastId.current) {
        lastId.current = newest
        requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }))
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }, [pet.id, role, onRead])

  useEffect(() => {
    load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  const other = role === 'owner' ? (pet.caretaker_name || 'the caretaker') : 'the owner'

  return (
    <div className="chat card">
      <header className="chat-head">
        <div>
          <h2>Messages</h2>
          <p className="muted small">
            About {pet.name}, with {other}. Times are your local time.
          </p>
        </div>
        {role === 'caretaker' && <AskTendedButton pet={pet} variant="small" />}
      </header>

      <div className="chat-scroll">
        {error && <p className="error">{error}</p>}
        {messages && messages.length === 0 && <p className="empty">No messages yet. Say hi!</p>}
        {messages?.map((m, i) => {
          const d = new Date(m.created_at)
          const day = dayIn(d, tz, { weekday: 'long', month: 'short', day: 'numeric' })
          const prevDay = i > 0 ? dayIn(new Date(messages[i - 1].created_at), tz, { weekday: 'long', month: 'short', day: 'numeric' }) : null
          const mine = m.sender_role === role
          return (
            <div key={m.id}>
              {day !== prevDay && <p className="chat-day">{day}</p>}
              <div className={`bubble-row ${mine ? 'mine' : 'theirs'}`}>
                <div className="bubble">
                  {!mine && <p className="bubble-name">{m.sender_name}</p>}
                  {m.photo_url && (
                    <a href={m.photo_url} target="_blank" rel="noreferrer">
                      <img className="bubble-photo" src={m.photo_url} alt={`Photo from ${m.sender_name}`} />
                    </a>
                  )}
                  {m.text && <p className="bubble-text">{m.text}</p>}
                  <p className="bubble-meta">
                    {mine ? 'You' : m.sender_name} · {timeIn(d, tz)}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <Composer pet={pet} role={role} onSent={load} />
    </div>
  )
}

function Composer({ pet, role, onSent }: { pet: Pet; role: Role; onSent: () => void }) {
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    if (sending || (!text.trim() && !photo)) return
    setSending(true)
    setError(null)
    try {
      await api.sendMessage(pet.id, role, text, photo)
      setText('')
      setPhoto(null)
      if (fileRef.current) fileRef.current.value = ''
      onSent()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <form className="composer" onSubmit={send}>
      {error && <p className="error">{error}</p>}
      {photo && (
        <p className="composer-photo">
          📎 {photo.name}{' '}
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              setPhoto(null)
              if (fileRef.current) fileRef.current.value = ''
            }}
          >
            Remove
          </button>
        </p>
      )}
      <div className="composer-row">
        <label className="btn ghost attach" title="Add a photo">
          📷
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
        </label>
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={`Message about ${pet.name}…`}
          aria-label="Message"
        />
        <button className="btn primary" disabled={sending || (!text.trim() && !photo)}>
          Send
        </button>
      </div>
    </form>
  )
}
