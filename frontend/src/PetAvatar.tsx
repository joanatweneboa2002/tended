import type { Pet } from './api'

// Shows the pet's photo, or a small HTML/CSS-drawn face when there isn't one.
export function PetAvatar({ pet, size = 56 }: { pet: Pet; size?: number }) {
  if (pet.photo_url) {
    return (
      <img
        className="avatar avatar-photo"
        src={pet.photo_url}
        alt={pet.name}
        style={{ width: size, height: size }}
      />
    )
  }
  const species = pet.species.toLowerCase()
  const kind = species.includes('cat') || species.includes('kitten')
    ? 'cat'
    : species.includes('rabbit') || species.includes('bunny')
      ? 'rabbit'
      : species.includes('dog') || species.includes('puppy')
        ? 'dog'
        : 'generic'
  return (
    <div
      className={`avatar critter critter-${kind}`}
      style={{ width: size, height: size, fontSize: size }}
      role="img"
      aria-label={`${pet.name} (${pet.species})`}
    >
      <span className="ear ear-l" />
      <span className="ear ear-r" />
      <span className="face">
        <span className="eye eye-l" />
        <span className="eye eye-r" />
        <span className="nose" />
        <span className="cheek cheek-l" />
        <span className="cheek cheek-r" />
      </span>
    </div>
  )
}
