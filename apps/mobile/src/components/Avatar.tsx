import { Image, StyleSheet, Text, View } from 'react-native';

import { photoUrl } from '@/lib/avatars';

import { colors } from './theme';

// Фото профиля, а если его нет — первые буквы имени на цвете из кабинета.
export function Avatar({
  name,
  path,
  color,
  size = 48,
}: {
  name: string;
  path?: string | null;
  color?: string | null;
  size?: number;
}) {
  const url = photoUrl(path);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    // Array.from — чтобы эмодзи (две половинки в UTF-16) не ломались.
    .map((word) => Array.from(word)[0].toUpperCase())
    .join('');
  const box = { width: size, height: size, borderRadius: size / 2 };

  if (url) return <Image source={{ uri: url }} style={[box, styles.border]} />;
  return (
    <View style={[box, styles.border, styles.empty, { backgroundColor: color ?? colors.primary }]}>
      <Text style={[styles.initials, { fontSize: size * 0.38 }]}>{initials || '?'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  border: { borderWidth: 3, borderColor: colors.surface },
  empty: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.primaryText, fontWeight: '700' },
});
