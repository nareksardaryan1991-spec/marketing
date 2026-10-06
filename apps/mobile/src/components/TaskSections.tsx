import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { TaskStatus } from '@/lib/types';

import { EmptyCounters } from './NavList';
import { TaskListCard, type TaskRow } from './TasksList';
import { ErrorText } from './ui';

export type TaskSection = { key: string; title: string; statuses: TaskStatus[]; assigneeId?: string };

// Разделы задач на главной сотрудника: где есть задачи — карточка со списком,
// пустые разделы сворачиваются в одну строку счётчиков, чтобы не листать «нечего показывать».
export function TaskSections({ sections }: { sections: TaskSection[] }) {
  const [tasks, setTasks] = useState<Record<string, TaskRow[]> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(sections.map((s) => [s.key, s.statuses, s.assigneeId]));

  useFocusEffect(
    useCallback(() => {
      const list = JSON.parse(key) as [string, TaskStatus[], string | undefined][];
      Promise.all(
        list.map(([, statuses, assigneeId]) => {
          let query = supabase
            .from('tasks')
            .select('*, services(name), businesses(name)')
            .in('status', statuses)
            .order('due_date', { ascending: true, nullsFirst: false })
            .order('created_at')
            .limit(100);
          if (assigneeId) query = query.eq('assignee_id', assigneeId);
          return query;
        }),
      ).then((results) => {
        setError(results.find((r) => r.error)?.error?.message ?? null);
        setTasks(Object.fromEntries(list.map(([k], i) => [k, (results[i].data as TaskRow[] | null) ?? []])));
      });
    }, [key]),
  );

  if (!tasks) return null;
  const empty = sections.filter((s) => !tasks[s.key]?.length);

  return (
    <>
      <ErrorText>{error}</ErrorText>
      {sections
        .filter((s) => tasks[s.key]?.length)
        .map((s) => (
          <TaskListCard key={s.key} title={s.title} tasks={tasks[s.key]} />
        ))}
      <EmptyCounters items={empty.map((s) => ({ title: s.title, count: 0 }))} />
    </>
  );
}
