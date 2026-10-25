// Thin client for the FastAPI backend in backend/main.py.
// Vite proxies /api and /photos to http://127.0.0.1:8000 (see vite.config.ts).

export type TaskType = 'feed' | 'walk' | 'meds' | 'potty' | 'other'
export type Repeat = 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'once'
export type CheckinStatus = 'done' | 'could_not'
export type Role = 'owner' | 'caretaker'
export type AppointmentKind = 'vet' | 'groomer' | 'other'
export type Appetite = 'none' | 'some' | 'normal'
export type Water = 'less' | 'normal' | 'more'
export type Energy = 'low' | 'normal' | 'high'
export type Potty = 'normal' | 'off'

export interface Pet {
  id: number
  name: string
  species: string
  breed: string
  age_years: number | null
  weight: number | null
  weight_unit: 'lb' | 'kg'
  photo_url: string | null
  quirks: string
  owner_timezone: string
  home_timezone: string
  caretaker_name: string
  is_sample: boolean
  created_at: string
}

export type PetInput = Omit<Pet, 'id' | 'photo_url' | 'is_sample' | 'created_at'>

export interface Task {
  id: number
  pet_id: number
  title: string
  type: TaskType
  time: string
  repeat: Repeat
  repeat_on: string | null
  notes: string
  dose: string | null
  active: number
}

export type TaskInput = Pick<Task, 'title' | 'type' | 'time' | 'repeat' | 'repeat_on' | 'notes' | 'dose'>

export interface Checkin {
  id: number
  task_id: number
  pet_id: number
  task_type: TaskType
  slot_date: string
  slot_time: string
  status: CheckinStatus
  reason: string | null
  note: string
  photo_url: string | null
  caretaker_name: string
  created_at: string
  task_title?: string
  task_dose?: string | null
}

export interface DayTask extends Task {
  checkins: Checkin[]
  dose_given: boolean
}

export interface EmergencyFields {
  owner_name: string
  owner_phone: string
  backup_name: string
  backup_phone: string
  vet_name: string
  vet_phone: string
  vet_address: string
  allergies: string
  conditions: string
  medications: string
  vaccines: string
  diet: string
  emergency_spending_limit: number | null
  microchip_number: string
}

export interface EmergencyCard extends EmergencyFields {
  pet_id: number
  pet: Pet
  scheduled_meds: { title: string; time: string; dose: string }[]
}

export interface Appointment {
  id: number
  pet_id: number
  kind: AppointmentKind
  title: string
  date: string // pet's home time
  time: string // pet's home time
  place_name: string
  address: string
  taken_by: Role
  bring: string
  visit_notes: string
  created_at: string
  starts_at: string // UTC
  is_past: boolean
}

export type AppointmentInput = Pick<
  Appointment,
  'kind' | 'title' | 'date' | 'time' | 'place_name' | 'address' | 'taken_by' | 'bring' | 'visit_notes'
>

export interface HealthLog {
  id: number
  pet_id: number
  log_date: string
  logged_at: string
  logged_by: string
  weight: number | null
  weight_unit: 'lb' | 'kg'
  appetite: Appetite | null
  water: Water | null
  energy: Energy | null
  potty: Potty | null
  symptoms: string
}

export type HealthInput = Partial<Pick<HealthLog, 'weight' | 'appetite' | 'water' | 'energy' | 'potty'>> & {
  symptoms?: string
}

export interface Message {
  id: number
  pet_id: number
  sender_role: Role
  sender_name: string
  text: string
  photo_url: string | null
  created_at: string
  read_at: string | null
}

export interface Alert {
  level: 'urgent' | 'warning' | 'info'
  kind: string
  text: string
  at: string | null
}

export interface DashTask extends DayTask {
  due_at: string
  state: 'done' | 'could_not' | 'pending'
}

type Latest<T> = { value: T; date: string } | null

export interface Dashboard {
  pet: Pet
  role: Role
  today: string
  home_time: string
  progress: { done: number; total: number }
  tasks: DashTask[]
  next_task: DashTask | null
  alerts: Alert[]
  next_appointment: Appointment | null
  latest_message: Message | null
  unread_messages: number
  latest_checkin: Checkin | null
  latest_photo_checkin: Checkin | null
  health: {
    entries: number
    weight: { value: number; unit: string; date: string; change: number | null; since: string | null } | null
    appetite: Latest<Appetite>
    water: Latest<Water>
    energy: Latest<Energy>
    potty: Latest<Potty>
    symptoms: Latest<string>
  }
}

// ---- agents ----

export interface AgentEvent {
  id: number
  run_id: number | null
  pet_id: number
  agent: string
  kind: string
  message: string
  detail: Record<string, unknown> | null
  created_at: string
}

export interface SetupQuestion {
  id: string
  about: string
  question: string
  answer: string | null
  round: number
}

export interface SetupFlag {
  id: string
  severity: 'emergency' | 'concern'
  message: string
  advice: string
  source_text: string
  from: 'agent' | 'safety_check'
}

export interface TaskDraft extends TaskInput {
  replaces_task_id: number | null
  replaces?: { id: number; title: string; time: string; dose: string | null }
  source_text?: string
}

export interface AppointmentDraft extends Omit<AppointmentInput, 'taken_by' | 'visit_notes'> {
  taken_by: Role | null
  visit_notes?: string
  source_text?: string
}

export interface QuirkDraft {
  text: string
  source_text?: string
}

interface SetupItemBase {
  id: string
  state: 'pending' | 'approved' | 'removed'
  source_text: string
  warnings: string[]
  saved_id: number | null
  edited?: boolean
}
export type SetupItem =
  | (SetupItemBase & { kind: 'task'; data: TaskDraft })
  | (SetupItemBase & { kind: 'appointment'; data: AppointmentDraft })
  | (SetupItemBase & { kind: 'quirk'; data: QuirkDraft })

export interface SetupRun {
  id: number
  pet_id: number
  agent: string
  status: 'thinking' | 'needs_answers' | 'proposal' | 'done' | 'error'
  created_at: string
  updated_at: string
  instructions: string
  round: number
  qa: SetupQuestion[]
  items: SetupItem[]
  flags: SetupFlag[]
  summary: string
  error: string | null
}

export interface HelperSource {
  id: string
  kind: 'profile' | 'emergency_card' | 'log' | 'reference'
  label: string
  detail: string
  source?: string
}

export interface HelperEmergency {
  reason: string
  vet_name: string
  vet_phone: string
  vet_address: string
  spending_limit: number | null
  owner_name: string
  owner_phone: string
  backup_name: string
  backup_phone: string
  reference: HelperSource[]
}

export interface HelperRun {
  id: number
  pet_id: number
  status: 'thinking' | 'answered' | 'not_sure' | 'emergency'
  created_at: string
  question: string
  answer: string
  sources: HelperSource[]
  emergency: HelperEmergency | null
  suggest_message_owner: boolean
  messaged_owner: boolean
  owner_name: string
}

export interface WatchAlert {
  level: 'urgent' | 'watch' | 'fyi'
  kind: string
  title: string
  noticed: string
  action: string
  evidence: string[]
  references: { id: string; topic: string; source: string }[]
  from: 'agent' | 'code'
}

export interface CheckRun {
  id: number
  pet_id: number
  status: 'running' | 'done' | 'stopped' | 'error'
  created_at: string
  updated_at: string
  finished_at?: string
  message: string
  alerts: WatchAlert[]
  summary: { summary: string; written_at: string } | null
  suspicious: { record_id: string; reason: string; from: string; text: string }[]
  suggestions_created: number
  budget: { max_calls: number; calls: number; max_tokens: number; tokens: number; cached_tokens: number }
  steps: { agent: string; status: string }[]
}

export interface LogSuggestionItem {
  id: number
  pet_id: number
  message_id: number | null
  log_date: string
  fields: Partial<Record<'appetite' | 'water' | 'energy' | 'potty' | 'symptoms', string>> & { weight?: number }
  quote: string
  reason: string
  status: 'pending' | 'approved' | 'dismissed'
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') message = body.detail
      else if (Array.isArray(body.detail)) {
        message = body.detail
          .map((d: { msg?: string }) => (d.msg ?? '').replace(/^Value error, /, ''))
          .join(' ')
      }
    } catch {
      // keep the status text
    }
    throw new ApiError(res.status, message)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  pets: () => request<Pet[]>('/api/pets'),
  createPet: (p: PetInput) => request<Pet>('/api/pets', json('POST', p)),
  updatePet: (id: number, p: PetInput) => request<Pet>(`/api/pets/${id}`, json('PUT', p)),
  deletePet: (id: number) => request<void>(`/api/pets/${id}`, { method: 'DELETE' }),
  uploadPetPhoto: (id: number, file: File) => {
    const form = new FormData()
    form.append('photo', file)
    return request<Pet>(`/api/pets/${id}/photo`, { method: 'POST', body: form })
  },

  tasks: (petId: number) => request<Task[]>(`/api/pets/${petId}/tasks`),
  createTask: (petId: number, t: TaskInput) =>
    request<Task>(`/api/pets/${petId}/tasks`, json('POST', t)),
  updateTask: (id: number, t: TaskInput) => request<Task>(`/api/tasks/${id}`, json('PUT', t)),
  deleteTask: (id: number) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),

  day: (petId: number, date: string) =>
    request<{ date: string; tasks: DayTask[] }>(`/api/pets/${petId}/day?date=${date}`),
  checkins: (petId: number, since?: string) =>
    request<Checkin[]>(`/api/pets/${petId}/checkins${since ? `?since=${since}` : ''}`),
  checkIn: (data: {
    task_id: number
    slot_date: string
    status: CheckinStatus
    reason?: string
    note?: string
    caretaker_name?: string
    photo?: File | null
  }) => {
    const form = new FormData()
    form.append('task_id', String(data.task_id))
    form.append('slot_date', data.slot_date)
    form.append('status', data.status)
    form.append('reason', data.reason ?? '')
    form.append('note', data.note ?? '')
    form.append('caretaker_name', data.caretaker_name ?? '')
    if (data.photo) form.append('photo', data.photo)
    return request<Checkin>('/api/checkins', { method: 'POST', body: form })
  },

  emergency: (petId: number) => request<EmergencyCard>(`/api/pets/${petId}/emergency`),
  updateEmergency: (petId: number, e: EmergencyFields) =>
    request<EmergencyCard>(`/api/pets/${petId}/emergency`, json('PUT', e)),

  dashboard: (petId: number, role: Role) =>
    request<Dashboard>(`/api/pets/${petId}/dashboard?role=${role}`),

  appointments: (petId: number) => request<Appointment[]>(`/api/pets/${petId}/appointments`),
  createAppointment: (petId: number, a: AppointmentInput) =>
    request<Appointment>(`/api/pets/${petId}/appointments`, json('POST', a)),
  updateAppointment: (id: number, a: AppointmentInput) =>
    request<Appointment>(`/api/appointments/${id}`, json('PUT', a)),
  deleteAppointment: (id: number) => request<void>(`/api/appointments/${id}`, { method: 'DELETE' }),

  health: (petId: number, days = 14) => request<HealthLog[]>(`/api/pets/${petId}/health?days=${days}`),
  logHealth: (petId: number, h: HealthInput) =>
    request<HealthLog>(`/api/pets/${petId}/health`, json('POST', h)),

  messages: (petId: number) => request<Message[]>(`/api/pets/${petId}/messages`),
  sendMessage: (petId: number, role: Role, text: string, photo: File | null) => {
    const form = new FormData()
    form.append('sender_role', role)
    form.append('text', text)
    if (photo) form.append('photo', photo)
    return request<Message>(`/api/pets/${petId}/messages`, { method: 'POST', body: form })
  },
  markRead: (petId: number, role: Role) =>
    request<{ unread: number }>(`/api/pets/${petId}/messages/read?role=${role}`, { method: 'POST' }),
  unread: (petId: number, role: Role) =>
    request<{ unread: number }>(`/api/pets/${petId}/messages/unread?role=${role}`),

  startSetup: (petId: number, instructions: string) =>
    request<SetupRun>(`/api/pets/${petId}/setup-agent`, json('POST', { instructions })),
  latestSetup: (petId: number) => request<SetupRun | null>(`/api/pets/${petId}/setup-agent/latest`),
  answerSetup: (runId: number, answers: Record<string, string>) =>
    request<SetupRun>(`/api/setup-agent/${runId}/answers`, json('POST', { answers })),
  approveSetupItem: (runId: number, itemId: string, data?: object) =>
    request<SetupRun>(`/api/setup-agent/${runId}/items/${itemId}/approve`, json('POST', { data: data ?? null })),
  removeSetupItem: (runId: number, itemId: string) =>
    request<SetupRun>(`/api/setup-agent/${runId}/items/${itemId}/remove`, { method: 'POST' }),
  askHelper: (petId: number, question: string) =>
    request<HelperRun>(`/api/pets/${petId}/helper`, json('POST', { question })),
  helperMessageOwner: (runId: number) =>
    request<HelperRun>(`/api/helper/${runId}/message-owner`, { method: 'POST' }),
  runCheck: (petId: number) => request<CheckRun>(`/api/pets/${petId}/check`, { method: 'POST' }),
  latestCheck: (petId: number) => request<CheckRun | null>(`/api/pets/${petId}/check/latest`),
  logSuggestions: (petId: number) => request<LogSuggestionItem[]>(`/api/pets/${petId}/log-suggestions`),
  approveSuggestion: (id: number) => request<LogSuggestionItem>(`/api/log-suggestions/${id}/approve`, { method: 'POST' }),
  dismissSuggestion: (id: number) => request<LogSuggestionItem>(`/api/log-suggestions/${id}/dismiss`, { method: 'POST' }),
  agentEvents: (petId: number) => request<AgentEvent[]>(`/api/pets/${petId}/agent-events`),

  resetSamples: () => request<{ ok: boolean }>('/api/sample/reset', { method: 'POST' }),
}

// ---- small shared helpers ----

export const TASK_TYPES: { value: TaskType; label: string; icon: string }[] = [
  { value: 'feed', label: 'Feed', icon: '🥣' },
  { value: 'walk', label: 'Walk', icon: '🦮' },
  { value: 'meds', label: 'Meds', icon: '💊' },
  { value: 'potty', label: 'Potty', icon: '🧻' },
  { value: 'other', label: 'Other', icon: '✨' },
]
export const typeIcon = (t: TaskType) => TASK_TYPES.find((x) => x.value === t)?.icon ?? '•'

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export function repeatLabel(t: Pick<Task, 'repeat' | 'repeat_on'>): string {
  switch (t.repeat) {
    case 'daily':
      return 'Every day'
    case 'weekdays':
      return 'Weekdays'
    case 'weekends':
      return 'Weekends'
    case 'weekly':
      return `Every ${t.repeat_on ? t.repeat_on[0].toUpperCase() + t.repeat_on.slice(1) : 'week'}`
    case 'once':
      return t.repeat_on ? `Once on ${formatDate(t.repeat_on)}` : 'Once'
  }
}

/** YYYY-MM-DD for a Date in the browser's local time. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return isoDate(new Date(y, m - 1, d + days))
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts)
}

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

