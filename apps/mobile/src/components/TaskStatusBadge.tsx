import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { teamStage, type TeamStage } from '@/lib/teamTasks';
import type { TaskKind, TaskStatus } from '@/lib/types';
import { tints } from '@/components/theme';

const TONES: Record<TaskStatus, { bg: string; fg: string }> = {
  new: tints.amber,
  assigned: tints.blue,
  in_progress: tints.accent,
  internal_review: tints.violet,
  client_review: tints.pink,
  changes_requested: tints.red,
  approved: tints.green,
  publishing: tints.teal,
  published: tints.neutral,
};

// Задача команды — пять этапов (src/lib/teamTasks.ts): «Бэклог», «К выполнению», «В работе», «На проверке», «Готово».
const STAGE_TONES: Record<TeamStage, { bg: string; fg: string }> = {
  backlog: tints.neutral,
  todo: TONES.assigned,
  in_progress: TONES.in_progress,
  review: TONES.internal_review,
  done: TONES.approved,
};

export function TaskStatusBadge({ status, kind = 'order' }: { status: TaskStatus; kind?: TaskKind }) {
  const { t } = useI18n();
  const stage = kind === 'team' ? teamStage(status) : null;
  const tone = stage ? STAGE_TONES[stage] : TONES[status];
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.text, { color: tone.fg }]}>
        {stage ? t(`teamTasks.status.${stage}`) : t(`taskStatus.${status}`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  text: { fontSize: 13, fontWeight: '600' },
});
