import { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { isVideo } from '@/lib/approvals';
import { isImage } from '@/lib/files';

import { MarkDots } from './MarkDots';
import { clamp, mediaStyles as styles, type MediaPageProps } from './mediaShared';

// В браузере видео играет прямо в превью. Чтобы отметить момент, клиент ставит видео
// на нужную секунду, нажимает «📍» и затем — место в кадре.
export function MediaPage({ path, url, width, height, marks, onPlace, placeLabel }: MediaPageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [placing, setPlacing] = useState(false);
  const video = isVideo(path);
  const catchTaps = !!onPlace && (!video || placing);

  return (
    <View style={[styles.page, { width, height }]}>
      {url && isImage(path) ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : url && video ? (
        <video
          ref={videoRef}
          src={url}
          controls={!placing}
          playsInline
          preload="metadata"
          style={{ width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#111827' }}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          <Text style={styles.ext}>{path.split('.').pop()?.toUpperCase()}</Text>
        </View>
      )}
      {catchTaps && (
        <Pressable
          style={[StyleSheet.absoluteFill, placing && local.placing]}
          onPress={(e) => {
            const v = videoRef.current;
            v?.pause();
            onPlace?.(
              clamp(e.nativeEvent.locationX / width),
              clamp(e.nativeEvent.locationY / height),
              video && v ? Math.round(v.currentTime * 10) / 10 : null,
            );
            setPlacing(false);
          }}
        />
      )}
      <MarkDots marks={marks} width={width} height={height} />
      {onPlace && video && !placing && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            videoRef.current?.pause();
            setPlacing(true);
          }}
          style={local.pin}>
          <Text style={local.pinText}>📍 {placeLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const local = StyleSheet.create({
  placing: { backgroundColor: 'rgba(239,68,68,0.12)', cursor: 'crosshair' } as object,
  pin: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  pinText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
});
