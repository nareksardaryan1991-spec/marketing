import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import type { TaskKind, TaskStatus } from '@/lib/types';

const TONES: Record<TaskStatus, { bg: string; fg: string }> = {
  new: { bg: '#FEF3C7', fg: '#92400E' },
  assigned: { bg: '#E0F2FE', fg: '#075985' },
  in_progress: { bg: '#E0E7FF', fg: '#3730A3' },
  internal_review: { bg: '#F3E8FF', fg: '#6B21A8' },
  client_review: { bg: '#FCE7F3', fg: '#9D174D' },
  changes_requested: { bg: '#FEE2E2', fg: '#991B1B' },
  approved: { bg: '#DCFCE7', fg: '#166534' },
  publishing: { bg: '#CCFBF1', fg: '#115E59' },
  published: { bg: '#E5E7EB', fg: '#374151' },
};

// У задачи команды четыре понятных статуса: «Новая», «В работе», «На проверке», «Готово».
const TEAM_STATUS: Partial<Record<TaskStatus, string>> = {
  new: 'new',
  assigned: 'new',
  in_progress: 'in_progress',
  changes_requested: 'in_progress',
  internal_review: 'internal_review',
  approved: 'done',
};

export function TaskStatusBadge({ status, kind = 'order' }: { status: TaskStatus; kind?: TaskKind }) {
  const { t } = useI18n();
  const team = kind === 'team' ? TEAM_STATUS[status] : undefined;
  const tone = team === 'new' ? TONES.assigned : TONES[status];
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.text, { color: tone.fg }]}>
        {team ? t(`teamTasks.status.${team}`) : t(`taskStatus.${status}`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  text: { fontSize: 13, fontWeight: '600' },
});
