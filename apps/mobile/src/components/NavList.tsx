import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

// Единый стиль переходов: переход на другой экран — всегда строка в карточке со стрелкой ›.
// Залитые кнопки остаются только для действий («Новый заказ», «Сохранить», «Принять»).
export function NavList({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function NavRow({
  icon,
  title,
  hint,
  count,
  href,
  onPress,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  // Число справа (например, непрочитанные); 0 и undefined не показываются.
  count?: number;
  href?: Href;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={count ? `${title}, ${count}` : title}
      onPress={onPress ?? (() => href && router.push(href))}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Ionicons name={icon} size={22} color={colors.primary} />
      <View style={styles.texts}>
        <Text style={styles.rowTitle}>{title}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {count ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

// Пустые разделы — не отдельной карточкой «нечего показывать», а компактными счётчиками в одну строку.
export function EmptyCounters({ items }: { items: { title: string; count?: number }[] }) {
  if (!items.length) return null;
  return (
    <View style={styles.counters}>
      {items.map((item) => (
        <View key={item.title} style={styles.counter}>
          <Ionicons name="checkmark-circle" size={16} color="#16A34A" />
          <Text style={styles.counterText}>
            {item.title} · {item.count ?? 0}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: { fontSize: 18, fontWeight: '600', color: colors.text, paddingTop: 12, paddingBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingVertical: 8,
  },
  pressed: { opacity: 0.6 },
  texts: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, color: colors.text },
  hint: { fontSize: 13, color: colors.muted },
  badge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  badgeText: { color: colors.primaryText, fontSize: 13, fontWeight: '700' },
  counters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  counterText: { fontSize: 14, color: colors.muted },
});
