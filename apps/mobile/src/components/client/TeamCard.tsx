import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { AGENTS, type AgentId } from '@/lib/agents';
import { supabase } from '@/lib/supabase';

import { AgentAvatar } from '../agents/AgentAvatar';
import { colors } from '../theme';
import { Card } from '../ui';

type TaskRow = {
  id: string;
  order_id: string;
  service_id: string;
  status: string;
  due_date: string | null;
  publish_at: string | null;
};

// Кто из агентов отвечает за услугу (SEO отдельной услуги пока нет).
const SERVICE_AGENTS: Record<string, AgentId[]> = {
  post: ['smm', 'designer'],
  story: ['designer'],
  reel: ['scriptwriter'],
  video_shoot: ['scriptwriter'],
  ads_management: ['targetologist'],
};

const WORKING = ['new', 'assigned', 'in_progress', 'internal_review', 'changes_requested'];
const PUBLISHING = ['approved', 'publishing'];

type Status =
  | { kind: 'waiting'; count: number }
  | { kind: 'working' | 'publishing'; task: TaskRow; date: string | null }
  | { kind: 'idle' };

function statusFor(agent: AgentId, tasks: TaskRow[]): Status {
  const mine = tasks.filter((t) => SERVICE_AGENTS[t.service_id]?.includes(agent));
  const waiting = mine.filter((t) => t.status === 'client_review');
  if (waiting.length) return { kind: 'waiting', count: waiting.length };
  const byDate = (a: string | null, b: string | null) => (a ?? '9999').localeCompare(b ?? '9999');
  const working = mine.filter((t) => WORKING.includes(t.status)).sort((a, b) => byDate(a.due_date, b.due_date))[0];
  if (working) return { kind: 'working', task: working, date: working.due_date };
  const publishing = mine
    .filter((t) => PUBLISHING.includes(t.status))
    .map((t) => ({ t, date: t.publish_at?.slice(0, 10) ?? t.due_date }))
    .sort((a, b) => byDate(a.date, b.date))[0];
  if (publishing) return { kind: 'publishing', task: publishing.t, date: publishing.date };
  return { kind: 'idle' };
}

function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// «Ваша команда» на главной клиента: что сейчас делает каждый агент — по настоящим задачам.
export function TeamCard() {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      supabase
        .from('tasks')
        .select('id, order_id, service_id, status, due_date, publish_at')
        .in('status', [...WORKING, 'client_review', ...PUBLISHING])
        .then(({ data }) => setTasks((data as TaskRow[] | null) ?? []));
    }, []),
  );

  if (!tasks) return null;

  const dayWord = (date: string | null) => {
    if (!date) return null;
    if (date === localDate(0)) return { word: t('crew.today'), relative: true };
    if (date === localDate(1)) return { word: t('crew.tomorrow'), relative: true };
    if (date < localDate(0)) return null;
    const weekday = new Date(`${date}T12:00:00`).getDay();
    return { word: t(`crew.dayAcc.${weekday}`), relative: false };
  };

  const line = (status: Status) => {
    if (status.kind === 'idle') return t('crew.idle');
    if (status.kind === 'waiting') {
      return status.count > 1 ? t('crew.waitingMany', { count: status.count }) : t('crew.waiting');
    }
    const item = t(`crew.items.${status.task.service_id}`);
    const day = dayWord(status.date);
    if (status.kind === 'working') {
      return day ? t('crew.workingOn', { item, day: day.word }) : t('crew.working', { item });
    }
    if (!day) return t('crew.publishingSoon', { item });
    return day.relative
      ? t('crew.publishingRelative', { item, day: day.word })
      : t('crew.publishingOn', { item, day: day.word });
  };

  const open = (status: Status) => {
    if (status.kind === 'waiting') router.push('/approvals');
    else if (status.kind !== 'idle') router.push(`/orders/${status.task.order_id}`);
  };

  return (
    <Card>
      <Text style={styles.title}>{t('crew.yourTeam')}</Text>
      {AGENTS.filter((a) => a.id !== 'manager').map((agent) => {
        const status = statusFor(agent.id, tasks);
        const active = status.kind !== 'idle';
        return (
          <Pressable
            key={agent.id}
            accessibilityRole={active ? 'button' : undefined}
            disabled={!active}
            onPress={() => open(status)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
            <AgentAvatar agent={agent} size={40} />
            <View style={styles.texts}>
              <Text style={styles.name}>
                {t(`agents.names.${agent.id}`)}
                <Text style={styles.role}> · {t(`agents.roles.${agent.id}`)}</Text>
              </Text>
              <Text style={[styles.status, status.kind === 'waiting' && styles.waiting, !active && styles.idle]}>
                {line(status)}
              </Text>
            </View>
            {active && <Text style={styles.chevron}>›</Text>}
          </Pressable>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  texts: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  role: { fontWeight: '400', color: colors.muted },
  status: { fontSize: 14, color: colors.text },
  waiting: { color: '#B45309', fontWeight: '600' },
  idle: { color: colors.muted },
  chevron: { fontSize: 24, color: colors.muted },
});
