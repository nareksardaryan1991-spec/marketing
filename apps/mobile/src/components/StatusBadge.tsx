import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import type { OrderStatus } from '@/lib/types';

const TONES: Record<OrderStatus, { bg: string; fg: string }> = {
  pending_payment: { bg: '#FEF3C7', fg: '#92400E' },
  paid: { bg: '#DCFCE7', fg: '#166534' },
  in_progress: { bg: '#E0E7FF', fg: '#3730A3' },
  completed: { bg: '#E5E7EB', fg: '#374151' },
  cancelled: { bg: '#FEE2E2', fg: '#991B1B' },
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
  text: { fontSize: 13, fontWeight: '600' },
});
