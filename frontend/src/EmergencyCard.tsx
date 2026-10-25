import { useEffect, useState, type ReactNode } from 'react'
import { api, formatTime, type EmergencyCard as Card } from './api'
import { createPortal } from 'react-dom'
import { Icon } from './Icons'
import { PetAvatar } from './PetAvatar'

function Phone({ number }: { number: string }) {
  if (!number) return <span className="muted">Not set</span>
  return <a className="phone" href={`tel:${number.replace(/[^\d+]/g, '')}`}>{number}</a>
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ec-row">
      <dt>{label}</dt>
      <dd>{children || <span className="muted">Not set</span>}</dd>
    </div>
  )
}

/** SOS: a small round white button with a red heart-pulse icon. One tap opens the emergency card. */
export function EmergencyButton({ petId }: { petId: number | null }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className="sos-btn"
        onClick={() => setOpen(true)}
        disabled={petId === null}
        aria-haspopup="dialog"
        aria-label="SOS: open the emergency card"
        title="Emergency card"
      >
        <span className="sos-circle" aria-hidden>
          <Icon name="heartPulse" size={22} />
        </span>
      </button>
      {open && petId !== null && createPortal(<EmergencyModal petId={petId} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function EmergencyModal({ petId, onClose }: { petId: number; onClose: () => void }) {
  const [card, setCard] = useState<Card | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.emergency(petId).then(setCard, (e) => setError(e.message))
  }, [petId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal emergency-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Emergency card"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ec-head">
          <div className="ec-title">
            {card && <PetAvatar pet={card.pet} size={52} />}
            <div>
              <p className="ec-kicker">Emergency card</p>
              <h2>{card ? card.pet.name : 'Loading…'}</h2>
              {card && (
                <p className="ec-sub">
                  {card.pet.species}
                  {card.pet.breed && ` · ${card.pet.breed}`}
                  {card.pet.weight != null && ` · ${card.pet.weight} ${card.pet.weight_unit}`}
                  {card.pet.is_sample && <span className="badge sample">Sample data</span>}
                </p>
              )}
            </div>
          </div>
          <button className="icon-btn on-red" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {error && <p className="error">{error}</p>}
        {card && (
          <div className="ec-body">
            <section className="ec-call">
              <div className="call-box vet">
                <p className="call-label">Vet</p>
                <p className="call-name">{card.vet_name || 'Not set'}</p>
                <Phone number={card.vet_phone} />
                {card.vet_address && (
                  <a
                    className="addr"
                    href={`https://maps.google.com/?q=${encodeURIComponent(card.vet_address)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {card.vet_address}
                  </a>
                )}
              </div>
              <div className="call-box">
                <p className="call-label">Owner</p>
                <p className="call-name">{card.owner_name || 'Not set'}</p>
                <Phone number={card.owner_phone} />
                <p className="muted small">Time zone: {card.pet.owner_timezone}</p>
              </div>
              <div className="call-box">
                <p className="call-label">Backup contact</p>
                <p className="call-name">{card.backup_name || 'Not set'}</p>
                <Phone number={card.backup_phone} />
              </div>
            </section>

            <section className="ec-limit">
              <span>Approved emergency spending</span>
              <strong>
                {card.emergency_spending_limit != null
                  ? `up to $${card.emergency_spending_limit.toLocaleString()}`
                  : 'Not set: call the owner first'}
              </strong>
            </section>

            <dl className="ec-grid">
              <Row label="Allergies">{card.allergies}</Row>
              <Row label="Conditions">{card.conditions}</Row>
              <Row label="Medications">
                {card.medications}
                {card.scheduled_meds.length > 0 && (
                  <ul className="ec-meds">
                    {card.scheduled_meds.map((m) => (
                      <li key={m.title + m.time}>
                        {formatTime(m.time)}: {m.dose}
                      </li>
                    ))}
                  </ul>
                )}
              </Row>
              <Row label="Vaccines">{card.vaccines}</Row>
              <Row label="Diet">{card.diet}</Row>
              <Row label="Microchip #">{card.microchip_number}</Row>
            </dl>
          </div>
        )}
      </div>
    </div>
  )
}
