import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatSize, type Attachment } from '@/lib/chat';

import { chatColors } from './chatTheme';
import { VideoAttachment } from './VideoAttachment';
import { VoicePlayer } from './VoicePlayer';

const PHOTO_WIDTH = 260;

// Вложения сообщения: фото (одно крупно или сеткой), видео, голосовые, файлы.
export function Attachments({
  attachments,
  urls,
  mine,
  onOpenPhoto,
}: {
  attachments: Attachment[];
  urls: Record<string, string>;
  mine: boolean;
  onOpenPhoto: (photos: Attachment[], index: number) => void;
}) {
  const photos = attachments.filter((a) => a.kind === 'photo');
  const others = attachments.filter((a) => a.kind !== 'photo');

  return (
    <View style={styles.list}>
      {photos.length === 1 && (
        <Pressable accessibilityRole="imagebutton" onPress={() => onOpenPhoto(photos, 0)}>
          <Image
            source={{ uri: urls[photos[0].path] }}
            accessibilityLabel={photos[0].name}
            style={[
              styles.photo,
              {
                width: PHOTO_WIDTH,
                height: Math.min(
                  340,
                  Math.max(120, (PHOTO_WIDTH * (photos[0].height ?? 3)) / (photos[0].width ?? 4)),
                ),
              },
            ]}
          />
        </Pressable>
      )}
      {photos.length > 1 && (
        <View style={styles.grid}>
          {photos.map((photo, index) => (
            <Pressable key={photo.path} accessibilityRole="imagebutton" onPress={() => onOpenPhoto(photos, index)}>
              <Image
                source={{ uri: urls[photo.path] }}
                accessibilityLabel={photo.name}
                style={[styles.photo, styles.gridPhoto]}
              />
            </Pressable>
          ))}
        </View>
      )}
      {others.map((attachment) => {
        const url = urls[attachment.path];
        if (attachment.kind === 'voice') {
          return (
            <VoicePlayer
              key={attachment.path}
              url={url}
              path={attachment.path}
              duration={attachment.duration}
              mine={mine}
            />
          );
        }
        if (attachment.kind === 'video') {
          return <VideoAttachment key={attachment.path} attachment={attachment} url={url} />;
        }
        return (
          <Pressable
            key={attachment.path}
            accessibilityRole="link"
            disabled={!url}
            onPress={() => url && Linking.openURL(url)}
            style={styles.file}>
            <View style={styles.fileIcon}>
              <Text style={styles.fileIconText}>📄</Text>
            </View>
            <View style={styles.fileText}>
              <Text style={styles.fileName} numberOfLines={2}>
                {attachment.name}
              </Text>
              <Text style={[styles.fileSize, mine && styles.fileSizeMine]}>{formatSize(attachment.size)}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 6 },
  photo: { borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.08)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, width: PHOTO_WIDTH },
  gridPhoto: { width: (PHOTO_WIDTH - 4) / 2, height: (PHOTO_WIDTH - 4) / 2 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 200, maxWidth: 280 },
  fileIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: chatColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileIconText: { fontSize: 18 },
  fileText: { flex: 1, gap: 2 },
  fileName: { fontSize: 14, fontWeight: '600', color: chatColors.text },
  fileSize: { fontSize: 12, color: chatColors.meta },
  fileSizeMine: { color: chatColors.metaMine },
});
