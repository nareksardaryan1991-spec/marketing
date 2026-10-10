import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { dueTone } from '@/lib/due';
import type { TeamTaskRow } from '@/lib/teamTasks';
import type { Profile } from '@/lib/types';

import { Avatar } from '../Avatar';
import { DueBadge } from '../DueBadge';
import { PriorityBadge } from '../PriorityBadge';
import { TaskStatusBadge } from '../TaskStatusBadge';
import { colors, tints, outlinedSmall } from '../theme';

export type Person = Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_path' | 'accent_color'>;

// Карточка задачи команды — строка списка и карточка на доске. Просроченная — с красной полосой слева.
// showStatus: в списке статус виден на карточке, на доске его заменяет колонка.
export function TeamTaskItem({
  task,
  person,
  showStatus,
  unassignedLabel,
}: {
  task: TeamTaskRow;
  person: Person | undefined;
  showStatus: boolean;
  unassignedLabel: string;
}) {
  const overdue = dueTone(task.due_date, task.status) === 'overdue';
  // Проект и клиент; проект часто называют по клиенту — тогда одно название.
  const where = [...new Set([task.team_projects?.name, task.businesses?.name].filter(Boolean))].join(' · ');
  return (
    <Link href={`/tasks/${task.id}`} asChild>
      {/* Link asChild передаёт стиль прямо в DOM — только одним объектом, не списком. */}
      <Pressable style={StyleSheet.flatten([styles.card, overdue && styles.overdue])}>
        <View style={styles.top}>
          <View style={styles.flex}>
            <Text style={styles.title} numberOfLines={2}>
              {task.title}
            </Text>
            {!!where && (
              <Text style={styles.where} numberOfLines={1}>
                {where}
              </Text>
            )}
          </View>
          {person ? (
            <Avatar name={person.full_name || person.email || '?'} path={person.avatar_path} color={person.accent_color} size={28} />
          ) : (
            !task.assignee_id && <Text style={styles.noAssignee}>{unassignedLabel}</Text>
          )}
        </View>
        <View style={styles.badges}>
          {showStatus && <TaskStatusBadge status={task.status} kind="team" />}
          <PriorityBadge priority={task.priority} />
          <DueBadge due={task.due_date} status={task.status} />
          {(task.tags ?? []).map((tag) => (
            <Text key={tag} style={styles.tag}>
              #{tag}
            </Text>
          ))}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 6,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...outlinedSmall,
  },
  overdue: { borderColor: tints.red.bg, borderLeftWidth: 4, borderLeftColor: colors.danger, backgroundColor: colors.dangerSurface },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  where: { fontSize: 13, color: colors.muted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  tag: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  noAssignee: { fontSize: 12, color: colors.warning },
});
