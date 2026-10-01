import { StyleSheet, Text, View } from 'react-native';

import type { ApprovalMark } from '@/lib/types';

export type NumberedMark = ApprovalMark & { n: number };

// Пронумерованные точки правок поверх кадра. Нажатия проходят сквозь них к кадру.
export function MarkDots({ marks, width, height }: { marks: NumberedMark[]; width: number; height: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {marks.map((m) => (
        <View
          key={m.n}
          style={[styles.dot, { left: m.x * width - DOT / 2, top: m.y * height - DOT / 2 }]}>
          <Text style={styles.n}>{m.n}</Text>
        </View>
      ))}
    </View>
  );
}

const DOT = 26;

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: '#EF4444',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  n: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
