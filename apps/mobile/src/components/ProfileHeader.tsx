import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { photoUrl } from '@/lib/avatars';
import type { Profile } from '@/lib/types';

import { Avatar } from './Avatar';
import { colors, fonts, outlined } from './theme';

// Обложка, фото и имя — вверху главного экрана и в личном кабинете.
export function ProfileHeader({
  profile,
  subtitle,
  children,
}: {
  profile: Profile;
  subtitle?: string;
  children?: ReactNode;
}) {
  const cover = photoUrl(profile.cover_path);
  // Цвет из кабинета; не выбран — спокойная серая обложка, без яркого пятна.
  const accent = profile.accent_color;
  return (
    <View style={styles.card}>
      <View style={[styles.cover, { backgroundColor: accent ?? colors.surfaceAlt }]}>
        {cover && <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
      </View>
      <View style={styles.body}>
        <View style={styles.avatar}>
          <Avatar
            name={profile.full_name}
            path={profile.avatar_path}
            color={accent}
            size={88}
          />
        </View>
        <Text style={styles.name}>{profile.full_name || profile.email}</Text>
        {!!subtitle && <Text style={styles.muted}>{subtitle}</Text>}
        {!!profile.bio && <Text style={styles.bio}>{profile.bio}</Text>}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    overflow: 'hidden',
    ...outlined,
  },
  cover: { height: 110 },
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 4 },
  avatar: { marginTop: -44, marginBottom: 4 },
  name: { fontSize: 22, fontFamily: fonts.display, color: colors.text },
  muted: { fontSize: 15, color: colors.muted },
  bio: { fontSize: 15, color: colors.text, marginTop: 4 },
});
