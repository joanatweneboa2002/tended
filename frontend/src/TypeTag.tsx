import { TASK_TYPES, type TaskType } from './api'

export function TypeTag({ type }: { type: TaskType }) {
  const t = TASK_TYPES.find((x) => x.value === type)
  return (
    <span className={`type-tag type-${type}`}>
      <span aria-hidden>{t?.icon}</span> {t?.label ?? type}
    </span>
  )
}
