import type { UserRole } from './types';

// Те же правила, что в базе (is_manager / is_team_role / is_employee_role).

// Управляет работой: менеджер и владелец.
export function isManagerRole(role: UserRole | undefined): boolean {
  return role === 'manager' || role === 'admin';
}

// Штатная команда: видит все задачи и заказы. Фрилансер и сотрудник (employee) — только свои.
export function isTeamRole(role: UserRole | undefined): boolean {
  return !!role && !['client', 'pending', 'freelancer', 'employee'].includes(role);
}

// Сотрудник агентства (с фрилансерами и владельцем), а не клиент и не ожидающий роли.
export function isEmployeeRole(role: UserRole | undefined): boolean {
  return !!role && !['client', 'pending'].includes(role);
}

// AI-агенты: у всех сотрудников агентства, кроме роли «Сотрудник».
export function canUseAgents(role: UserRole | undefined): boolean {
  return isEmployeeRole(role) && role !== 'employee';
}

// Подпись к человеку: должность, если владелец её задал, иначе название роли.
export function roleLabel(
  t: (key: string) => string,
  person: { role: UserRole; job_title?: string | null },
): string {
  return person.job_title || t(`roles.${person.role}`);
}

// Роли, которые владелец может назначить (сам владелец назначается только в базе).
export const ASSIGNABLE_ROLES: UserRole[] = [
  'manager',
  'employee',
  'designer',
  'videographer',
  'video_editor',
  'photographer',
  'copywriter',
  'smm',
  'targetologist',
  'seo',
  'freelancer',
  'client',
];
