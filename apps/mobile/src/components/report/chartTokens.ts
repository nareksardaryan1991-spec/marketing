import { colors } from '../theme';

// Цвета графиков (проверены validate_palette из навыка dataviz на белом фоне).
export const chart = {
  accent: colors.primary,
  // Приглушённые метки в форме «выделение»: не лучший пост.
  deemphasis: '#C3C2B7',
  up: '#006300',
  down: colors.danger,
};

// 1 284 · 12.9K · 4.2M — компактно для плиток.
export function compactNumber(value: number, locale: string): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return new Intl.NumberFormat(locale).format(value);
}
