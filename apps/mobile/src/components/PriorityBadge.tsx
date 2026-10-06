import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import type { TaskPriority } from '@/lib/types';

const TONES: Record<TaskPriority, { bg: string; fg: string }> = {
  low: { bg: '#F3F4F6', fg: '#4B5563' },
  normal: { bg: '#E0F2FE', fg: '#075985' },
  high: { bg: '#FFEDD5', fg: '#9A3412' },
  urgent: { bg: '#FEE2E2', fg: '#991B1B' },
};

// Важность задачи команды. Обычную не показываем в списках (quiet), чтобы выделялись важные.
export function PriorityBadge({ priority, quiet = true }: { priority: TaskPriority; quiet?: boolean }) {
  const { t } = useI18n();
  if (quiet && priority === 'normal') return null;
  const tone = TONES[priority] ?? TONES.normal;
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.text, { color: tone.fg }]}>
        {priority === 'urgent' ? '‼ ' : priority === 'high' ? '! ' : ''}
        {t(`teamTasks.priority.${priority}`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  text: { fontSize: 12, fontWeight: '600' },
});
