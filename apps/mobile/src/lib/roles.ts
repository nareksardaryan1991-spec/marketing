import type { UserRole } from './types';

// Те же правила, что в базе (is_manager / is_team_role / is_employee_role).

// Управляет работой: менеджер и владелец.
export function isManagerRole(role: UserRole | undefined): boolean {
  return role === 'manager' || role === 'admin';
}

// Штатная команда: сотрудники без фрилансеров.
export function isTeamRole(role: UserRole | undefined): boolean {
  return !!role && !['client', 'pending', 'freelancer'].includes(role);
}

// Сотрудник агентства (с фрилансерами и владельцем), а не клиент и не ожидающий роли.
export function isEmployeeRole(role: UserRole | undefined): boolean {
  return !!role && !['client', 'pending'].includes(role);
}

// Роли, которые владелец может назначить (сам владелец назначается только в базе).
export const ASSIGNABLE_ROLES: UserRole[] = [
  'manager',
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
