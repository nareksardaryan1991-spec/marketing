import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { logoUrl, profileCompleteness } from '@/lib/brand';
import type { Business } from '@/lib/types';

import { Avatar } from './Avatar';
import { colors } from './theme';

// Карточка «Ваш бизнес» на главной клиента — единственный вход в профиль бизнеса.
// Показывает, насколько профиль заполнен: агенты используют его в каждой задаче.
export function BusinessCard({ business }: { business: Business }) {
  const { t } = useI18n();
  const url = logoUrl(business.logo_path);
  const percent = profileCompleteness(business);
  const brand = business.brand_colors ?? [];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={t('home.openProfile')}
      onPress={() => router.push('/business')}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}>
      <View style={styles.head}>
        {url ? (
          <Image source={{ uri: url }} style={styles.logo} contentFit="contain" />
        ) : (
          <Avatar name={business.name} color={brand[0]} size={56} />
        )}
        <View style={styles.titles}>
          <Text style={styles.label}>{t('home.yourBusiness')}</Text>
          <Text style={styles.name}>{business.name}</Text>
          <Text style={styles.muted}>{[business.industry, business.city].filter(Boolean).join(' · ')}</Text>
        </View>
        {brand.length > 0 && (
          <View style={styles.dots}>
            {brand.map((c) => (
              <View key={c} style={[styles.dot, { backgroundColor: c }]} />
            ))}
          </View>
        )}
      </View>

      <View
        style={styles.bar}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: percent }}>
        <View style={[styles.barFill, { width: `${percent}%` }]} />
      </View>
      <Text style={styles.muted}>
        {percent < 100 ? t('home.profileFilled', { percent }) : t('home.profileComplete')}
      </Text>
      <View style={styles.linkRow}>
        <Text style={styles.link}>{percent < 100 ? t('home.completeProfile') : t('home.openProfile')}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 56, height: 56, borderRadius: 12 },
  titles: { flex: 1, gap: 2 },
  label: { fontSize: 13, color: colors.muted, textTransform: 'uppercase' },
  name: { fontSize: 18, fontWeight: '600', color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: colors.border },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  link: { fontSize: 15, fontWeight: '600', color: colors.primary },
});
