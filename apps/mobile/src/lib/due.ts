import type { TaskStatus } from './types';
import { tints } from '@/components/theme';

// Работа ещё за командой (как is_open_task_status в базе): у клиента и после одобрения
// срок уже не горит.
export const OPEN_STATUSES: TaskStatus[] = ['new', 'assigned', 'in_progress', 'internal_review', 'changes_requested'];

export type DueTone = 'overdue' | 'today' | 'tomorrow';

// Сегодняшняя дата телефона в виде YYYY-MM-DD (так хранится срок задачи).
export function todayIso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dueTone(due: string | null, status: TaskStatus): DueTone | null {
  if (!due || !OPEN_STATUSES.includes(status)) return null;
  if (due < todayIso()) return 'overdue';
  if (due === todayIso()) return 'today';
  if (due === todayIso(1)) return 'tomorrow';
  return null;
}

export const DUE_COLORS: Record<DueTone, { bg: string; fg: string }> = {
  overdue: tints.red,
  today: tints.orange,
  tomorrow: tints.amber,
};
