import { StyleSheet } from 'react-native';

import type { NumberedMark } from './MarkDots';

export type MediaPageProps = {
  path: string;
  url: string | undefined;
  width: number;
  height: number;
  marks: NumberedMark[];
  // Режим правок: нажатие ставит точку (x, y — доли кадра; секунда видео, если известна).
  onPlace?: (x: number, y: number, seconds: number | null) => void;
  placeLabel?: string;
};

export const clamp = (v: number) => Math.min(1, Math.max(0, v));

export const mediaStyles = StyleSheet.create({
  page: { overflow: 'hidden', backgroundColor: '#111827' },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1F2937' },
  play: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { color: '#FFFFFF', fontSize: 26, marginLeft: 4 },
  ext: { color: '#9CA3AF', fontSize: 16, fontWeight: '700' },
});
