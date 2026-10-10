import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '@/lib/chat';

import { chatColors } from './chatTheme';

const BARS = 28;

// Настоящую форму звука не считаем — рисуем постоянную «волну» от имени файла.
function waveHeights(path: string) {
  let seed = 0;
  for (const ch of path) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const heights: number[] = [];
  for (let i = 0; i < BARS; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    heights.push(4 + (seed % 17));
  }
  return heights;
}

// Голосовое: кнопка ▶/⏸, «волна» с прогрессом и время.
export function VoicePlayer({
  url,
  path,
  duration,
  mine,
}: {
  url: string | undefined;
  path: string;
  duration?: number;
  mine: boolean;
}) {
  const player = useAudioPlayer(url ? { uri: url } : null);
  const status = useAudioPlayerStatus(player);
  const total = status.duration || duration || 0;
  const progress = total > 0 ? Math.min(1, status.currentTime / total) : 0;

  const heights = useMemo(() => waveHeights(path), [path]);

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish || (total > 0 && status.currentTime >= total - 0.1)) player.seekTo(0);
    player.play();
  };

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'pause' : 'play'}
        onPress={toggle}
        disabled={!url}
        style={[styles.button, !url && styles.disabled]}>
        <Text style={styles.icon}>{status.playing ? '❚❚' : '▶'}</Text>
      </Pressable>
      <View style={styles.body}>
        <View style={styles.wave}>
          {heights.map((h, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                { height: h },
                { backgroundColor: i / BARS < progress ? chatColors.accent : mine ? chatColors.voiceBarMine : chatColors.voiceBar },
              ]}
            />
          ))}
        </View>
        <Text style={[styles.time, mine && styles.timeMine]}>
          {formatDuration(status.playing || status.currentTime > 0 ? status.currentTime : total)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 220, paddingVertical: 2 },
  button: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: chatColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  icon: { color: chatColors.accentText, fontSize: 15, fontWeight: '700', marginLeft: 2 },
  body: { flex: 1, gap: 3 },
  wave: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 22 },
  bar: { width: 3, borderRadius: 2 },
  time: { fontSize: 12, color: chatColors.meta },
  timeMine: { color: chatColors.metaMine },
});
