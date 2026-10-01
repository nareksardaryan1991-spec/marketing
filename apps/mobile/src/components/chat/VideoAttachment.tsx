import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Attachment } from '@/lib/chat';
import { formatSize } from '@/lib/chat';

// В приложении видео открывается во встроенном плеере телефона по ссылке.
export function VideoAttachment({ attachment, url }: { attachment: Attachment; url: string | undefined }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!url}
      onPress={() => url && Linking.openURL(url)}
      style={styles.tile}>
      <View style={styles.play}>
        <Text style={styles.playIcon}>▶</Text>
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {attachment.name} {formatSize(attachment.size)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 260,
    height: 160,
    borderRadius: 12,
    backgroundColor: '#1F2937',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 8,
  },
  play: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { color: '#FFFFFF', fontSize: 22, marginLeft: 3 },
  name: { color: '#E5E7EB', fontSize: 12, maxWidth: 240 },
});
