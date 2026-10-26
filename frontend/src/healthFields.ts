// Which health measures make sense for which species (mirrors backend/health.py).
// Birds' "activity" is stored as energy, and fish and reptiles' "eating" as
// appetite, so the Watchdog's trend checks work for every species.

import type { HealthLog } from './api'

export type SpeciesGroup = 'dog_cat' | 'bird' | 'fish' | 'reptile' | 'other'
export type ChoiceKey = 'appetite' | 'water' | 'energy' | 'potty' | 'droppings' | 'feathers' | 'swimming' | 'water_clarity' | 'shedding' | 'basking'

export interface ChoiceField {
  key: ChoiceKey
  label: string
  options: { value: string; label: string }[]
  worrying: string[] // values shown as a flag in the history
}

const opts = (...values: string[]) => values.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))

const APPETITE = (label: string): ChoiceField => ({ key: 'appetite', label, options: opts('none', 'some', 'normal'), worrying: ['none', 'some'] })
const ENERGY = (label: string): ChoiceField => ({ key: 'energy', label, options: opts('low', 'normal', 'high'), worrying: ['low'] })
const WATER: ChoiceField = { key: 'water', label: 'Water', options: opts('less', 'normal', 'more'), worrying: ['less', 'more'] }
const POTTY: ChoiceField = { key: 'potty', label: 'Potty', options: opts('normal', 'off'), worrying: ['off'] }
const DROPPINGS: ChoiceField = { key: 'droppings', label: 'Droppings', options: opts('normal', 'off'), worrying: ['off'] }
const FEATHERS: ChoiceField = { key: 'feathers', label: 'Feathers', options: opts('normal', 'ruffled', 'plucking'), worrying: ['ruffled', 'plucking'] }
const SWIMMING: ChoiceField = { key: 'swimming', label: 'Swimming', options: opts('normal', 'slow', 'odd'), worrying: ['slow', 'odd'] }
const CLARITY: ChoiceField = { key: 'water_clarity', label: 'Water clarity', options: opts('clear', 'cloudy'), worrying: ['cloudy'] }
const SHEDDING: ChoiceField = { key: 'shedding', label: 'Shedding', options: opts('none', 'normal', 'stuck'), worrying: ['stuck'] }
const BASKING: ChoiceField = { key: 'basking', label: 'Basking', options: opts('less', 'normal', 'more'), worrying: ['less'] }

export const FIELDS: Record<SpeciesGroup, { weight: boolean; choices: ChoiceField[] }> = {
  dog_cat: { weight: true, choices: [APPETITE('Appetite'), WATER, ENERGY('Energy'), POTTY] },
  bird: { weight: false, choices: [APPETITE('Appetite'), DROPPINGS, FEATHERS, ENERGY('Activity')] },
  fish: { weight: false, choices: [APPETITE('Eating'), SWIMMING, CLARITY] },
  reptile: { weight: false, choices: [APPETITE('Eating'), SHEDDING, BASKING] },
  other: { weight: false, choices: [APPETITE('Appetite'), ENERGY('Energy')] },
}

const WORDS: [SpeciesGroup, RegExp][] = [
  ['dog_cat', /\b(dog|puppy|cat|kitten)s?\b/],
  ['bird', /\b(bird|parrot|conure|budgie|parakeet|cockatiel|cockatoo|canary|finch|macaw|lovebird)s?\b/],
  ['fish', /\b(fish|goldfish|betta|guppy|guppies|koi|tetra|molly)s?\b/],
  ['reptile', /\b(reptile|lizard|gecko|snake|python|turtle|tortoise|iguana|chameleon|dragon|skink)s?\b/],
]

export function speciesGroup(species: string): SpeciesGroup {
  const s = species.toLowerCase()
  return WORDS.find(([, re]) => re.test(s))?.[0] ?? 'other'
}

/** Labels for showing any logged entry (older entries may have fields this species no longer shows). */
const ALL: ChoiceField[] = [APPETITE('Appetite'), WATER, ENERGY('Energy'), POTTY, DROPPINGS, FEATHERS, SWIMMING, CLARITY, SHEDDING, BASKING]

export function chipsFor(log: HealthLog, group: SpeciesGroup): { label: string; value: string; flag: boolean }[] {
  const mine = FIELDS[group].choices
  const out: { label: string; value: string; flag: boolean }[] = []
  if (log.weight != null) out.push({ label: 'Weight', value: `${log.weight} ${log.weight_unit}`, flag: false })
  for (const generic of ALL) {
    const f = mine.find((m) => m.key === generic.key) ?? generic
    const v = log[f.key]
    if (v) out.push({ label: f.label, value: v[0].toUpperCase() + v.slice(1), flag: f.worrying.includes(v) })
  }
  return out
}
