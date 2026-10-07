import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { fileName } from '@/lib/files';
import { formatDate, formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { TaskPriority, TaskStatus } from '@/lib/types';

import { TEAM_STATUS } from '../TaskStatusBadge';
import { colors } from '../theme';
import { Card } from '../ui';
import { taskStyles } from './styles';

type Entry = {
  id: string;
  actor_id: string | null;
  field: string;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
};

const PEOPLE_FIELDS = ['assignee_id', 'reviewer_id'];

// История задачи команды: кто, что и когда изменил. Записи делает сама база (task_history),
// здесь только показываем: одно изменение — одна строка «было → стало».
export function TaskHistory({ taskId }: { taskId: string }) {
  const { t, language } = useI18n();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('task_history')
        .select('id, actor_id, field, old_value, new_value, created_at')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false });
      const rows = (data as Entry[] | null) ?? [];
      // Имена: кто менял, исполнители, проверяющие и «Кто видит».
      const ids = new Set<string>();
      for (const e of rows) {
        if (e.actor_id) ids.add(e.actor_id);
        if (PEOPLE_FIELDS.includes(e.field) || e.field === 'watchers') {
          for (const v of [e.old_value, e.new_value].flat()) if (typeof v === 'string') ids.add(v);
        }
      }
      const people = ids.size
        ? ((await supabase.from('profiles').select('id, full_name, email').in('id', [...ids])).data ?? [])
        : [];
      if (!active) return;
      setNames(Object.fromEntries(people.map((p) => [p.id, p.full_name || p.email || '—'])));
      setEntries(rows);
    })();
    return () => {
      active = false;
    };
  }, [taskId]);

  if (entries.length === 0) return null;

  const person = (id: unknown) => (typeof id === 'string' ? (names[id] ?? '—') : t('task.unassigned'));
  const value = (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    switch (field) {
      case 'status': {
        const key = TEAM_STATUS[v as TaskStatus];
        return key ? t(`teamTasks.status.${key}`) : String(v);
      }
      case 'priority':
        return t(`teamTasks.priority.${v as TaskPriority}`);
      case 'due_date':
        return formatDate(String(v), language);
      case 'assignee_id':
      case 'reviewer_id':
        return person(v);
      case 'watchers':
        return (v as string[]).length ? (v as string[]).map(person).join(', ') : '—';
      case 'attachments':
        return (v as string[]).length ? (v as string[]).map(fileName).join(', ') : '—';
      case 'related_order_id':
        return t('teamTasks.history.linked');
      default: {
        const text = String(v);
        return text.length > 80 ? `${text.slice(0, 80)}…` : text;
      }
    }
  };

  return (
    <Card>
      <Text style={taskStyles.cardTitle}>{t('teamTasks.history.title')}</Text>
      {entries.map((e) => (
        <View key={e.id} style={styles.entry}>
          <Text style={styles.meta}>
            {e.actor_id ? (names[e.actor_id] ?? '—') : t('teamTasks.history.system')} · {formatDateTime(e.created_at, language)}
          </Text>
          {e.field === 'created' ? (
            <Text style={taskStyles.text}>{t('teamTasks.history.created')}</Text>
          ) : (
            <Text style={taskStyles.text}>
              <Text style={styles.field}>{t(`teamTasks.history.fields.${e.field}`)}: </Text>
              {value(e.field, e.old_value)} → {value(e.field, e.new_value)}
            </Text>
          )}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  entry: { gap: 2, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  meta: { fontSize: 13, color: colors.muted },
  field: { fontWeight: '600' },
});
