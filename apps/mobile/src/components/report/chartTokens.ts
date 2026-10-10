import { colors, theme } from '../theme';

// Цвета графиков: акцент — главное, серый — приглушённое (свои для каждого оформления).
export const chart = {
  accent: colors.primary,
  // Приглушённые метки в форме «выделение»: не лучший пост.
  deemphasis: theme.chart.deemphasis,
  up: theme.chart.up,
  down: colors.danger,
};

// 1 284 · 12.9K · 4.2M — компактно для плиток.
export function compactNumber(value: number, locale: string): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return new Intl.NumberFormat(locale).format(value);
}
