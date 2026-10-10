import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { tints } from '@/components/theme';

// «Проверено человеком»: версию одобрил менеджер перед отправкой клиенту.
// Пара к пометке «черновик AI» — клиент видит, что прошло через человека, а что нет.
export function HumanCheckBadge({ name }: { name?: string | null }) {
  const { t } = useI18n();
  const label = name ? t('humanCheck.by', { name }) : t('humanCheck.title');
  return (
    <View style={styles.badge} accessibilityRole="text" accessibilityLabel={label}>
      <Ionicons name="shield-checkmark" size={15} color={tints.green.fg} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: tints.green.bg,
  },
  text: { fontSize: 13, fontWeight: '600', color: tints.green.fg },
});
