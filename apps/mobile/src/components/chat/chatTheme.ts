import { theme } from '../theme';

// Цвета чатов в духе Telegram — свои у каждого оформления (components/theme.ts).
export const chatColors = theme.chat;

// Готовые фоны. Значение в профиле: «preset:<id>» или «photo:<путь в avatars>».
export const WALLPAPERS = theme.wallpapers;

// Цвета имён в групповых чатах — у каждого свой, как в Telegram.
const NAME_COLORS = theme.chat.names;

export function nameColor(id: string) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return NAME_COLORS[hash % NAME_COLORS.length];
}
