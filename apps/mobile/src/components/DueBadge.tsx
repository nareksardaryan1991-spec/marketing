import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { DUE_COLORS, dueTone } from '@/lib/due';
import { formatDate } from '@/lib/format';
import type { TaskStatus } from '@/lib/types';

import { colors } from './theme';

// Срок задачи: просрочено — красным, сегодня — оранжевым, завтра — жёлтым.
export function DueBadge({ due, status }: { due: string | null; status: TaskStatus }) {
  const { t, language } = useI18n();
  if (!due) return null;
  const tone = dueTone(due, status);
  const date = formatDate(due, language);
  if (!tone) return <Text style={styles.plain}>{date}</Text>;
  const color = DUE_COLORS[tone];
  return (
    <View style={[styles.badge, { backgroundColor: color.bg }]}>
      <Text style={[styles.text, { color: color.fg }]}>
        {t(`due.${tone}`)} · {date}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  plain: { fontSize: 13, color: colors.muted },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  text: { fontSize: 12, fontWeight: '700' },
});
