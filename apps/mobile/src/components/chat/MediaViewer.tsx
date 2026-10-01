import { Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useI18n } from '@/i18n';
import type { Attachment } from '@/lib/chat';

// Фото на весь экран; стрелки — если в сообщении несколько фото.
export function MediaViewer({
  photos,
  index,
  urls,
  onIndex,
  onClose,
}: {
  photos: Attachment[];
  index: number;
  urls: Record<string, string>;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const photo = photos[index];
  if (!photo) return null;
  const url = urls[photo.path];

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.top}>
          <Text style={styles.counter}>
            {photos.length > 1 ? `${index + 1} / ${photos.length}` : photo.name}
          </Text>
          {url && (
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(url)} style={styles.topButton}>
              <Text style={styles.topText}>{t('chats.openFile')}</Text>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel={t('chats.close')} onPress={onClose} style={styles.topButton}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        <Pressable style={styles.stage} onPress={onClose}>
          {url && <Image source={{ uri: url }} resizeMode="contain" style={styles.image} />}
        </Pressable>
        {photos.length > 1 && (
          <View style={styles.arrows}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="←"
              disabled={index === 0}
              onPress={() => onIndex(index - 1)}
              style={[styles.arrow, index === 0 && styles.arrowOff]}>
              <Text style={styles.arrowText}>‹</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="→"
              disabled={index === photos.length - 1}
              onPress={() => onIndex(index + 1)}
              style={[styles.arrow, index === photos.length - 1 && styles.arrowOff]}>
              <Text style={styles.arrowText}>›</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  counter: { flex: 1, color: '#FFFFFF', fontSize: 15 },
  topButton: { paddingHorizontal: 10, paddingVertical: 6 },
  topText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  close: { color: '#FFFFFF', fontSize: 22 },
  stage: { flex: 1 },
  image: { flex: 1, width: '100%' },
  arrows: { flexDirection: 'row', justifyContent: 'space-between', padding: 16 },
  arrow: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowOff: { opacity: 0.3 },
  arrowText: { color: '#FFFFFF', fontSize: 30, lineHeight: 32 },
});
