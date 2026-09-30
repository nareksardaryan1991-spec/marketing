import { StyleSheet } from 'react-native';

import type { Language } from '@/lib/types';

import { colors } from './theme';

export type DateTimeFieldProps = {
  label: string;
  value: Date | null;
  onChange: (value: Date | null) => void;
  // 'date' — только день (срок задачи), 'datetime' — день и время (публикация).
  mode: 'date' | 'datetime';
};

export const LOCALES: Record<Language, string> = { ru: 'ru-RU', hy: 'hy-AM', en: 'en-US' };

export function formatValue(value: Date, mode: DateTimeFieldProps['mode'], language: Language) {
  return value.toLocaleString(LOCALES[language], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(mode === 'datetime' ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

// Новая дата публикации по умолчанию — завтра в 10:00.
export function defaultValue(mode: DateTimeFieldProps['mode']): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(mode === 'datetime' ? 10 : 0, 0, 0, 0);
  return d;
}

export const fieldStyles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 14, fontWeight: '500', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  box: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  value: { fontSize: 16, color: colors.text },
  placeholder: { fontSize: 16, color: colors.muted },
  clear: { color: colors.danger, fontSize: 14, padding: 8 },
});
