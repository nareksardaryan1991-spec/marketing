import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { OPEN_STATUSES, todayIso } from '@/lib/due';
import { taskTitle } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import type { Localized, Task, TaskStatus } from '@/lib/types';

import { DueBadge } from './DueBadge';
import { TaskStatusBadge } from './TaskStatusBadge';
import { colors } from './theme';
import { Card, ErrorText } from './ui';

export type TaskRow = Task & {
  services: { name: Localized } | null;
  businesses: { name: string } | null;
};

export function TasksList({
  title,
  assigneeId,
  statuses,
  emptyText,
  overdueOnly,
}: {
  title: string;
  assigneeId?: string;
  statuses?: TaskStatus[];
  emptyText: string;
  // Только просроченные: срок прошёл, а работа ещё за командой.
  overdueOnly?: boolean;
}) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const statusKey = statuses?.join(',');

  useFocusEffect(
    useCallback(() => {
      let query = supabase
        .from('tasks')
        .select('*, services(name), businesses(name)')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at')
        .limit(100);
      if (assigneeId) query = query.eq('assignee_id', assigneeId);
      if (statusKey) query = query.in('status', statusKey.split(','));
      if (overdueOnly) query = query.lt('due_date', todayIso()).in('status', OPEN_STATUSES);
      query.then(({ data, error }) => {
        setError(error?.message ?? null);
        setTasks((data as TaskRow[] | null) ?? []);
      });
    }, [assigneeId, statusKey, overdueOnly]),
  );

  return <TaskListCard title={title} tasks={tasks} error={error} emptyText={emptyText} />;
}

// Карточка со списком задач — одна и та же в «Задачах», на главной и в панели владельца.
export function TaskListCard({
  title,
  tasks,
  error,
  emptyText,
}: {
  title: string;
  tasks: TaskRow[];
  error?: string | null;
  emptyText?: string;
}) {
  const { language } = useI18n();
  return (
    <Card>
      <Text style={styles.title}>
        {title} {tasks.length > 0 ? `(${tasks.length})` : ''}
      </Text>
      <ErrorText>{error}</ErrorText>
      {tasks.length === 0 && !error && emptyText ? <Text style={styles.muted}>{emptyText}</Text> : null}
      {tasks.map((task) => (
        <Link key={task.id} href={`/tasks/${task.id}`} asChild>
          <Pressable style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.name}>
                {taskTitle(task, task.services?.name, language)}
              </Text>
              {!!task.businesses?.name && <Text style={styles.muted}>{task.businesses.name}</Text>}
              <DueBadge due={task.due_date} status={task.status} />
            </View>
            <TaskStatusBadge status={task.status} />
          </Pressable>
        </Link>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '600', color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '500', color: colors.text },
});
