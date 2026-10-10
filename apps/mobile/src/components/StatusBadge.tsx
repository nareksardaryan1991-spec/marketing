import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import type { OrderStatus } from '@/lib/types';
import { fonts, tints } from '@/components/theme';

const TONES: Record<OrderStatus, { bg: string; fg: string }> = {
  pending_payment: tints.amber,
  paid: tints.green,
  in_progress: tints.accent,
  completed: tints.neutral,
  cancelled: tints.red,
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useI18n();
  const tone = TONES[status];
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.text, { color: tone.fg }]}>{t(`orderStatus.${status}`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  text: { fontSize: 13, fontWeight: '600', fontFamily: fonts.semibold },
});
