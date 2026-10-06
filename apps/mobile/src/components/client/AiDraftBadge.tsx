import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';

// Пометка на всём, что AI сделал без проверки человеком.
export function AiDraftBadge() {
  const { t } = useI18n();
  return (
    <View style={styles.badge} accessibilityRole="text">
      <Text style={styles.text}>🤖 {t('welcome.draftBadge')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
  },
  text: { fontSize: 13, fontWeight: '600', color: '#92400E' },
});
