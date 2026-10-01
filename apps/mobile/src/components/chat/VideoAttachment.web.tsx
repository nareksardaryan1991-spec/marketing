import { StyleSheet, View } from 'react-native';

import type { Attachment } from '@/lib/chat';

// В браузере видео играет прямо в сообщении.
export function VideoAttachment({ attachment, url }: { attachment: Attachment; url: string | undefined }) {
  return (
    <View style={styles.tile}>
      {url ? (
        <video
          src={url}
          controls
          preload="metadata"
          aria-label={attachment.name}
          style={{ width: '100%', height: '100%', borderRadius: 12, backgroundColor: '#1F2937' }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { width: 280, height: 180, borderRadius: 12, backgroundColor: '#1F2937', overflow: 'hidden' },
});
