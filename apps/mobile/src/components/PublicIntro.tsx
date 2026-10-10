import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';

import { colors, fonts } from './theme';

// Что это за сервис — на экране входа (это публичная главная для тех, кто не вошёл).
// Тот же текст лежит готовым HTML в public/index.html для поисковиков и превью ссылок.
const POINTS = ['agents', 'check', 'approve', 'packages'] as const;

export function PublicIntro() {
  const { t } = useI18n();
  return (
    <View style={styles.box}>
      <Text style={styles.title} accessibilityRole="header">
        {t('intro.title')}
      </Text>
      <Text style={styles.lead}>{t('intro.lead')}</Text>
      <Text style={styles.subtitle}>{t('intro.how')}</Text>
      {POINTS.map((key) => (
        <View key={key} style={styles.point}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.text}>{t(`intro.points.${key}`)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, marginTop: 16, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  title: { fontSize: 20, fontFamily: fonts.display, color: colors.text },
  lead: { fontSize: 15, lineHeight: 22, color: colors.muted },
  subtitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: 4 },
  point: { flexDirection: 'row', gap: 8 },
  bullet: { fontSize: 15, lineHeight: 22, color: colors.primary },
  text: { flex: 1, fontSize: 15, lineHeight: 22, color: colors.text },
});
