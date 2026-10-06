import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { agentById, type AgentRun, type ManagerPlan } from '@/lib/agents';
import { formatDateTime } from '@/lib/format';
import { isManagerRole } from '@/lib/roles';
import { taskTitle } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import type { Localized } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

import { colors } from '../theme';
import { Card, ErrorText } from '../ui';
import { ManagerPlanView } from './ManagerPlanView';
import { AgentTag } from './AgentAvatar';

type Row = AgentRun & {
  tasks: {
    service_id: string;
    platform_id: string | null;
    number: number;
    services: { name: Localized } | null;
    businesses: { name: string } | null;
  } | null;
};

// История запусков агентов. Пока кто-то работает — обновляем каждые 3 секунды.
export function AgentRuns({
  agent,
  taskId,
  refreshKey,
  onFinished,
}: {
  agent?: string;
  taskId?: string;
  // Меняется после нового запуска — список сразу перечитывается.
  refreshKey?: number;
  onFinished?: () => void;
}) {
  const { t, language } = useI18n();
  const { profile } = useAuth();
  const manager = isManagerRole(profile?.role);
  const [runs, setRuns] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(new Set<string>());

  const load = useCallback(async () => {
    let query = supabase
      .from('agent_runs')
      // Связь по agent_runs.task_id: у задачи есть и обратная ссылка (from_agent_run_id, «Передать человеку»).
      .select('*, tasks!agent_runs_task_id_fkey(service_id, platform_id, number, services(name), businesses(name))')
      .order('created_at', { ascending: false })
      .limit(20);
    // refreshKey в зависимостях: после нового запуска список перечитывается сразу.
    void refreshKey;
    if (agent) query = query.eq('agent', agent);
    // Запросы из чата видны в самом чате; здесь — только те, что попали в задачу.
    query = query.or('chat.eq.false,task_id.not.is.null');
    if (taskId) query = query.eq('task_id', taskId);
    const { data, error } = await query;
    setError(error?.message ?? null);
    const rows = (data as Row[] | null) ?? [];
    setRuns(rows);
    // Кто-то из «работает» закончил — сообщаем экрану (например, чтобы показать новую версию).
    const nowRunning = new Set(rows.filter((r) => r.status === 'running').map((r) => r.id));
    const finished = [...running.current].some((id) => !nowRunning.has(id));
    running.current = nowRunning;
    if (finished) onFinished?.();
  }, [agent, taskId, onFinished, refreshKey]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  const anyRunning = runs.some((r) => r.status === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [anyRunning, load]);

  if (runs.length === 0 && !error) return null;

  return (
    <Card>
      <Text style={styles.title}>{t('agents.history')}</Text>
      <ErrorText>{error}</ErrorText>
      {runs.map((run) => {
        const meta = agentById(run.agent);
        return (
          <View key={run.id} style={styles.row}>
            <View style={styles.head}>
              {meta ? <AgentTag agent={meta} /> : <View />}
              <StatusLabel status={run.status} />
            </View>
            {run.tasks && run.task_id && (
              <Link href={`/tasks/${run.task_id}`} style={styles.link}>
                {taskTitle(run.tasks, run.tasks.services?.name, language)}
                {run.tasks.businesses?.name ? ` · ${run.tasks.businesses.name}` : ''} →
              </Link>
            )}
            <Text style={styles.muted}>{formatDateTime(run.created_at, language)}</Text>
            {run.instructions ? <Text style={styles.muted}>«{run.instructions}»</Text> : null}
            {run.status === 'done' && run.agent !== 'manager' && (
              <Text style={styles.ok}>{t('agents.sentToReview')}</Text>
            )}
            {manager && run.status === 'done' && run.agent !== 'manager' && (
              <Link href={`/team-tasks/edit?from_run=${run.id}`} style={styles.link}>
                👤 {t('agents.handOff')} →
              </Link>
            )}
            {run.status === 'done' && run.agent === 'designer' &&
              (run.result as { backgrounds?: string } | null)?.backgrounds === 'gradient' && (
                <Text style={styles.muted}>{t('agents.noImageKey')}</Text>
              )}
            {run.status === 'failed' && <ErrorText>{run.error ?? t('common.error')}</ErrorText>}
            {run.agent === 'manager' && (run.status === 'done' || run.status === 'applied') && run.result && (
              <ManagerPlanView
                runId={run.id}
                plan={run.result as ManagerPlan}
                applied={run.status === 'applied'}
                onApplied={load}
              />
            )}
          </View>
        );
      })}
    </Card>
  );
}

function StatusLabel({ status }: { status: AgentRun['status'] }) {
  const { t } = useI18n();
  if (status === 'running') {
    return (
      <View style={styles.status}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.statusText, { color: colors.primary }]}>{t('agents.status.running')}</Text>
      </View>
    );
  }
  const color = status === 'failed' ? colors.danger : colors.muted;
  return <Text style={[styles.statusText, { color }]}>{t(`agents.status.${status}`)}</Text>;
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '600', color: colors.text },
  row: {
    gap: 4,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  link: { fontSize: 15, color: colors.primary },
  muted: { fontSize: 14, color: colors.muted },
  ok: { fontSize: 14, color: colors.text },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 14, fontWeight: '600' },
});
