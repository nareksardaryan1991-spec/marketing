import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { isVideo } from '@/lib/approvals';
import { isImage } from '@/lib/files';

import { MarkDots } from './MarkDots';
import { clamp, mediaStyles as styles, type MediaPageProps } from './mediaShared';

// Один кадр превью. В приложении видео открывается в плеере телефона,
// а точку на видео клиент ставит нажатием на плитку (секунду указывает сам).
export function MediaPage({ path, url, width, height, marks, onPlace }: MediaPageProps) {
  const video = isVideo(path);
  const place = (x: number, y: number) =>
    onPlace?.(clamp(x / width), clamp(y / height), null);

  return (
    <Pressable
      disabled={!onPlace}
      onPress={(e) => place(e.nativeEvent.locationX, e.nativeEvent.locationY)}
      style={[styles.page, { width, height }]}>
      {url && isImage(path) ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          {video ? (
            <Pressable
              accessibilityRole="button"
              disabled={!url}
              onPress={() => url && Linking.openURL(url)}
              style={styles.play}>
              <Text style={styles.playIcon}>▶</Text>
            </Pressable>
          ) : (
            <Text style={styles.ext}>{path.split('.').pop()?.toUpperCase()}</Text>
          )}
        </View>
      )}
      <MarkDots marks={marks} width={width} height={height} />
    </Pressable>
  );
}
