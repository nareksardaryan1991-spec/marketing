import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { AGENT_TASK_STATUSES, AGENTS, attachRun, type AgentId } from '@/lib/agents';
import { taskTitle } from '@/lib/platforms';
import { isManagerRole } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Localized, Task } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

import { colors } from '../theme';
import { Button, ErrorText } from '../ui';

type Row = Task & { services: { name: Localized } | null; businesses: { name: string } | null };

// Выбор задачи для результата из чата: сотруднику — свои задачи, менеджеру — все в работе.
export function AttachToTask({ runId, agent, onDone }: { runId: string; agent: AgentId; onDone: () => void }) {
  const { t, language } = useI18n();
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    const services = AGENTS.find((a) => a.id === agent)?.services;
    let query = supabase
      .from('tasks')
      .select('*, services(name), businesses(name)')
      .in('status', [...AGENT_TASK_STATUSES])
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(30);
    if (!isManagerRole(profile.role)) query = query.eq('assignee_id', profile.id);
    if (services) query = query.in('service_id', services);
    query.then(({ data, error }) => {
      setError(error?.message ?? null);
      setTasks((data as Row[] | null) ?? []);
    });
  }, [profile, agent]);

  const attach = async () => {
    if (!selected) {
      setError(t('agents.pickTask'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await attachRun(runId, selected);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t('agents.attachTitle')}</Text>
      {tasks.length === 0 && !error && <Text style={styles.muted}>{t('agents.noTasks')}</Text>}
      {tasks.map((task) => (
        <Pressable
          key={task.id}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected === task.id }}
          onPress={() => setSelected(task.id)}
          style={[styles.row, selected === task.id && styles.rowActive]}>
          <Text style={styles.name}>{taskTitle(task, task.services?.name, language)}</Text>
          {!!task.businesses?.name && <Text style={styles.muted}>{task.businesses.name}</Text>}
        </Pressable>
      ))}
      <ErrorText>{error}</ErrorText>
      {tasks.length > 0 && <Button title={t('agents.attach')} onPress={attach} loading={busy} />}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, paddingTop: 8 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  name: { fontSize: 15, color: colors.text },
  row: { padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, gap: 2 },
  rowActive: { borderColor: colors.primary, backgroundColor: colors.background },
});
