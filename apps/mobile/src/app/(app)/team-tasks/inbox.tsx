import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { colors, tints } from '@/components/theme';
import { Button, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDate, formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { teamStage } from '@/lib/teamTasks';
import type { TaskStatus } from '@/lib/types';

type Note = {
  id: string;
  kind: string;
  payload: {
    task_id?: string;
    title?: string;
    priority?: string;
    business?: string | null;
    comment?: string | null;
    author?: string;
    preview?: string;
    actor?: string | null;
    from?: TaskStatus;
    status?: TaskStatus;
    due_date?: string;
  };
  created_at: string;
  read_at: string | null;
};

const ICONS: Record<string, string> = {
  task_assigned: '📌',
  task_status: '🔄',
  task_comment: '💬',
  task_review: '🔍',
  task_returned: '↩️',
  task_done: '✅',
  task_due_soon: '⏰',
  task_due_today: '⏰',
  task_overdue: '🔴',
};

// Лента уведомлений по задачам команды: назначили, сменился статус, комментарий, сроки, проверка.
// Записи делает база (0029, 0035, 0039) — каждый видит только свои. Нажатие отмечает прочитанным и открывает задачу.
export default function TeamInboxScreen() {
  const { t, language } = useI18n();
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    supabase
      .from('notifications')
      .select('id, kind, payload, created_at, read_at')
      .eq('payload->>kind', 'team')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        setError(error?.message ?? null);
        setNotes((data as Note[] | null) ?? []);
        setLoaded(true);
      });
  }, []);

  useFocusEffect(load);

  const markRead = async (ids: string[] | null) => {
    const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids });
    if (error) {
      setError(error.message);
      return;
    }
    const now = new Date().toISOString();
    setNotes((all) => all.map((n) => (!ids || ids.includes(n.id) ? { ...n, read_at: n.read_at ?? now } : n)));
  };

  const stage = (status?: TaskStatus) => (status ? t(`teamTasks.status.${teamStage(status)}`) : '');
  const text = (n: Note) => {
    const p = n.payload;
    switch (n.kind) {
      case 'task_status':
        return t('teamTasks.inbox.status', { from: stage(p.from), to: stage(p.status), actor: p.actor ?? '' });
      case 'task_comment':
        return `${p.author ?? ''}: ${p.preview ?? ''}`;
      case 'task_returned':
        return p.comment ? `${t('teamTasks.inbox.task_returned')}: «${p.comment}»` : t('teamTasks.inbox.task_returned');
      case 'task_overdue':
        return `${t('teamTasks.inbox.task_overdue')} · ${p.due_date ? formatDate(p.due_date, language) : ''}`;
      default:
        return t(`teamTasks.inbox.${n.kind}`);
    }
  };

  const unread = notes.filter((n) => !n.read_at).length;

  return (
    <Screen>
      {unread > 0 && <Button title={t('teamTasks.inbox.readAll')} variant="ghost" onPress={() => markRead(null)} />}
      <ErrorText>{error}</ErrorText>
      {loaded && notes.length === 0 && <Text style={styles.empty}>{t('teamTasks.inbox.empty')}</Text>}
      {notes.map((n) => (
        <Pressable
          key={n.id}
          accessibilityRole="button"
          onPress={() => {
            if (!n.read_at) markRead([n.id]);
            if (n.payload.task_id) router.push(`/tasks/${n.payload.task_id}`);
          }}
          style={[styles.row, !n.read_at && styles.unread]}>
          <Text style={styles.icon}>{ICONS[n.kind] ?? '🔔'}</Text>
          <View style={styles.flex}>
            <Text style={styles.title} numberOfLines={2}>
              {n.payload.title}
            </Text>
            <Text style={styles.text} numberOfLines={3}>
              {text(n)}
            </Text>
            <Text style={styles.meta}>{formatDateTime(n.created_at, language)}</Text>
          </View>
          {!n.read_at && <View style={styles.dot} />}
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 24 },
  row: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unread: { borderColor: tints.accent.bg, backgroundColor: colors.accentSurface },
  icon: { fontSize: 20 },
  flex: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  text: { fontSize: 14, color: colors.text },
  meta: { fontSize: 12, color: colors.muted },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 6 },
});
