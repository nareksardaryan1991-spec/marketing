import { dueTone, todayIso } from './due';
import { isManagerRole } from './roles';
import type { Task, TaskPriority, TaskStatus, UserRole } from './types';

// Этапы задачи команды (колонки доски): Бэклог → К выполнению → В работе → На проверке → Готово.
// В базе это статусы tasks.status; «возвращена на доработку» у задачи команды — снова «В работе».
export type TeamStage = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';

export const TEAM_STAGES: { key: TeamStage; status: TaskStatus; color: string }[] = [
  { key: 'backlog', status: 'new', color: '#9CA3AF' },
  { key: 'todo', status: 'assigned', color: '#0EA5E9' },
  { key: 'in_progress', status: 'in_progress', color: '#6366F1' },
  { key: 'review', status: 'internal_review', color: '#A855F7' },
  { key: 'done', status: 'approved', color: '#16A34A' },
];

const STAGE_OF: Partial<Record<TaskStatus, TeamStage>> = {
  new: 'backlog',
  assigned: 'todo',
  in_progress: 'in_progress',
  changes_requested: 'in_progress',
  internal_review: 'review',
  approved: 'done',
};

export function teamStage(status: TaskStatus): TeamStage {
  return STAGE_OF[status] ?? 'backlog';
}

export const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

// Строка списка: задача с названиями клиента и проекта (из связей в запросе).
export type TeamTaskRow = Task & {
  businesses: { name: string } | null;
  team_projects: { name: string } | null;
};

export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'none';

export type TeamFilters = {
  // «Мои задачи» — где я исполнитель.
  scope: 'mine' | 'all';
  search: string;
  // id человека, 'none' — без исполнителя.
  assignee: string;
  // id проекта, 'none' — без проекта.
  project: string;
  priority: 'all' | TaskPriority;
  due: DueFilter;
  // 'open' — всё, кроме готовых.
  stage: 'all' | 'open' | TeamStage;
};

export const NO_FILTERS: Omit<TeamFilters, 'scope'> = {
  search: '',
  assignee: 'all',
  project: 'all',
  priority: 'all',
  due: 'all',
  stage: 'open',
};

function dueMatches(task: Task, due: DueFilter): boolean {
  switch (due) {
    case 'all':
      return true;
    case 'none':
      return !task.due_date;
    case 'overdue':
      return dueTone(task.due_date, task.status) === 'overdue';
    case 'today':
      return task.due_date === todayIso() && teamStage(task.status) !== 'done';
    case 'week':
      return !!task.due_date && task.due_date <= todayIso(7) && teamStage(task.status) !== 'done';
  }
}

// Поиск — по названию, описанию, тегам, проекту, клиенту и исполнителю, без учёта регистра.
function searchMatches(task: TeamTaskRow, words: string[], personName: (id: string) => string): boolean {
  if (words.length === 0) return true;
  const haystack = [
    task.title,
    task.brief,
    task.team_projects?.name,
    task.businesses?.name,
    task.assignee_id ? personName(task.assignee_id) : null,
    ...(task.tags ?? []).map((tag) => `#${tag}`),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

// Фильтры, кроме этапа: доска показывает все этапы колонками, список — ещё и фильтрует по этапу.
export function filterTeamTasks(
  tasks: TeamTaskRow[],
  filters: TeamFilters,
  userId: string | undefined,
  personName: (id: string) => string,
  withStage = true,
): TeamTaskRow[] {
  const words = filters.search.trim().toLowerCase().replace(/^#/, '').split(/\s+/).filter(Boolean);
  return tasks.filter(
    (task) =>
      (filters.scope === 'all' || task.assignee_id === userId) &&
      (filters.assignee === 'all' ||
        (filters.assignee === 'none' ? !task.assignee_id : task.assignee_id === filters.assignee)) &&
      (filters.project === 'all' ||
        (filters.project === 'none' ? !task.project_id : task.project_id === filters.project)) &&
      (filters.priority === 'all' || task.priority === filters.priority) &&
      dueMatches(task, filters.due) &&
      (!withStage ||
        filters.stage === 'all' ||
        (filters.stage === 'open' ? teamStage(task.status) !== 'done' : teamStage(task.status) === filters.stage)) &&
      searchMatches(task, words, personName),
  );
}

// Порядок: открытые — по сроку (без срока в конце), при равном сроке важные выше; готовые — последние, свежие сверху.
export function sortTeamTasks(tasks: TeamTaskRow[]): TeamTaskRow[] {
  return [...tasks].sort((a, b) => {
    const aDone = teamStage(a.status) === 'done';
    const bDone = teamStage(b.status) === 'done';
    if (aDone !== bDone) return aDone ? 1 : -1;
    if (aDone) return b.updated_at.localeCompare(a.updated_at);
    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    }
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.created_at.localeCompare(a.created_at);
  });
}

// Теги из поля ввода: через запятую или пробел, «#» не обязателен. Окончательно чистит база (clean_task_tags).
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,\s]+/)
        .map((tag) => tag.replace(/^#+/, '').trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

// Куда человек может переместить задачу на доске — те же правила, что в базе (set_team_task_status,
// submit_deliverable, review_task):
//   status — просто сменить этап: автор и владелец — между «Бэклог», «К выполнению», «В работе» (и открыть заново
//            готовую), исполнитель — между «К выполнению» и «В работе»; без исполнителя — только «Бэклог»;
//   submit — «На проверке»: исполнитель сдаёт результат на экране задачи;
//   accept — «Готово»: проверяющий (или владелец) принимает работу;
//   return — из проверки обратно «В работу»: проверяющий возвращает с комментарием на экране задачи.
export type TeamMove = 'status' | 'submit' | 'accept' | 'return';

export function teamMoves(
  task: Pick<Task, 'status' | 'assignee_id' | 'created_by' | 'reviewer_id'>,
  user: { id: string; role: UserRole } | null,
): Partial<Record<TeamStage, TeamMove>> {
  if (!user) return {};
  const from = teamStage(task.status);
  const owner = user.role === 'admin';
  const canEdit = owner || (isManagerRole(user.role) && task.created_by === user.id);
  const moves: Partial<Record<TeamStage, TeamMove>> = {};
  if (canEdit && from !== 'review') {
    for (const to of ['backlog', 'todo', 'in_progress'] as const) {
      if (to !== from && (to === 'backlog' || task.assignee_id)) moves[to] = 'status';
    }
  }
  if (task.assignee_id === user.id && (from === 'todo' || from === 'in_progress')) {
    moves[from === 'todo' ? 'in_progress' : 'todo'] = 'status';
    moves.review = 'submit';
  }
  if (from === 'review' && (owner || task.reviewer_id === user.id)) {
    moves.done = 'accept';
    moves.in_progress = 'return';
  }
  return moves;
}
