import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { applyManagerPlan, type ManagerPlan } from '@/lib/agents';
import { formatDate } from '@/lib/format';
import { taskTitle } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import type { Localized } from '@/lib/types';

import { colors } from '../theme';
import { Button, ErrorText } from '../ui';

type TaskInfo = { id: string; service_id: string; platform_id: string | null; number: number; services: { name: Localized } | null };

// План менеджер-агента: брифы, исполнители, сроки. Применяется только по кнопке.
export function ManagerPlanView({
  runId,
  plan,
  applied,
  onApplied,
}: {
  runId: string;
  plan: ManagerPlan;
  applied: boolean;
  onApplied: () => void;
}) {
  const { t, language } = useI18n();
  const [tasks, setTasks] = useState<Record<string, TaskInfo>>({});
  const [people, setPeople] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const taskIds = plan.tasks.map((p) => p.task_id);
    const personIds = [...new Set(plan.tasks.map((p) => p.assignee_id).filter(Boolean))];
    if (taskIds.length) {
      supabase
        .from('tasks')
        .select('id, service_id, platform_id, number, services(name)')
        .in('id', taskIds)
        .then(({ data }) => setTasks(Object.fromEntries(((data as TaskInfo[] | null) ?? []).map((r) => [r.id, r]))));
    }
    if (personIds.length) {
      supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', personIds)
        .then(({ data }) =>
          setPeople(Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name || p.email || '—']))),
        );
    }
  }, [plan]);

  const apply = async () => {
    setError(null);
    setBusy(true);
    try {
      await applyManagerPlan(runId);
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      <Text style={styles.text}>{plan.summary}</Text>
      {plan.tasks.map((item) => {
        const task = tasks[item.task_id];
        return (
          <View key={item.task_id} style={styles.item}>
            <Text style={styles.name}>
              {task ? taskTitle(task, task.services?.name, language) : '…'}
            </Text>
            <Text style={styles.text}>{item.brief}</Text>
            <Text style={styles.muted}>
              {t('agents.planAssignee')}: {item.assignee_id ? (people[item.assignee_id] ?? '…') : '—'}
              {item.due_date ? ` · ${t('agents.planDue')}: ${formatDate(item.due_date, language)}` : ''}
            </Text>
            {item.reason ? <Text style={styles.muted}>{item.reason}</Text> : null}
          </View>
        );
      })}
      <ErrorText>{error}</ErrorText>
      {applied ? (
        <Text style={styles.ok}>✓ {t('agents.planApplied')}</Text>
      ) : (
        <Button title={t('agents.applyPlan')} onPress={apply} loading={busy} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, marginTop: 4 },
  item: { gap: 2, padding: 10, borderRadius: 10, backgroundColor: colors.background },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  text: { fontSize: 15, color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  ok: { fontSize: 15, fontWeight: '600', color: colors.text },
});
