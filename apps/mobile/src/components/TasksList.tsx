import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { formatDate } from '@/lib/format';
import { taskTitle } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import type { Localized, Task, TaskStatus } from '@/lib/types';

import { TaskStatusBadge } from './TaskStatusBadge';
import { colors } from './theme';
import { Card, ErrorText } from './ui';

type Row = Task & {
  services: { name: Localized } | null;
  businesses: { name: string } | null;
};

export function TasksList({
  title,
  assigneeId,
  statuses,
  emptyText,
}: {
  title: string;
  assigneeId?: string;
  statuses?: TaskStatus[];
  emptyText: string;
}) {
  const { language } = useI18n();
  const [tasks, setTasks] = useState<Row[]>([]);
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
      query.then(({ data, error }) => {
        setError(error?.message ?? null);
        setTasks((data as Row[] | null) ?? []);
      });
    }, [assigneeId, statusKey]),
  );

  return (
    <Card>
      <Text style={styles.title}>
        {title} {tasks.length > 0 ? `(${tasks.length})` : ''}
      </Text>
      <ErrorText>{error}</ErrorText>
      {tasks.length === 0 && !error && <Text style={styles.muted}>{emptyText}</Text>}
      {tasks.map((task) => (
        <Link key={task.id} href={`/tasks/${task.id}`} asChild>
          <Pressable style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.name}>
                {taskTitle(task, task.services?.name, language)}
              </Text>
              <Text style={styles.muted}>
                {[task.businesses?.name, task.due_date && formatDate(task.due_date, language)]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
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
