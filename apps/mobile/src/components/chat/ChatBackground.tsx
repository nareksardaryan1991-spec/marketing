import type { ReactNode } from 'react';
import { ImageBackground, StyleSheet, View } from 'react-native';

import { photoUrl } from '@/lib/avatars';

import { WALLPAPERS } from './chatTheme';
import { PatternLayer } from './PatternLayer';

export function wallpaperOf(value: string | null | undefined) {
  if (value?.startsWith('photo:')) return { photo: photoUrl(value.slice(6)), color: '#2B3445', dark: true };
  const preset = WALLPAPERS.find((w) => `preset:${w.id}` === value) ?? WALLPAPERS[0];
  return { photo: null, color: preset.color, dark: !!preset.dark };
}

// Фон чата: цвет с узором или своё фото. Каждый выбирает в личном кабинете.
export function ChatBackground({ value, children }: { value: string | null | undefined; children: ReactNode }) {
  const wallpaper = wallpaperOf(value);
  if (wallpaper.photo) {
    return (
      <ImageBackground source={{ uri: wallpaper.photo }} resizeMode="cover" style={styles.fill}>
        {children}
      </ImageBackground>
    );
  }
  return (
    <View style={[styles.fill, { backgroundColor: wallpaper.color }]}>
      <PatternLayer light={wallpaper.dark} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
