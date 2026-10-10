import { Image, StyleSheet, Text, View } from 'react-native';

import { photoUrl } from '@/lib/avatars';

import { colors, textOn } from './theme';

// Фото профиля, а если его нет — первые буквы имени на цвете из кабинета
// (цвет не выбран — серый кружок с салатовыми буквами).
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
  const background = color ?? colors.surfaceAlt;
  return (
    <View style={[box, styles.border, styles.empty, { backgroundColor: background }]}>
      <Text style={[styles.initials, { fontSize: size * 0.38, color: color ? textOn(color) : colors.primary }]}>
        {initials || '?'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  border: { borderWidth: 3, borderColor: colors.surface },
  empty: { alignItems: 'center', justifyContent: 'center' },
  initials: { fontWeight: '700' },
});
