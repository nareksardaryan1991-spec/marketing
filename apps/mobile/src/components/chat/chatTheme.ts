// Цвета чатов в духе Telegram: свои сообщения справа голубые, чужие — белые слева.
export const chatColors = {
  mine: '#DCEEFF',
  theirs: '#FFFFFF',
  text: '#14151A',
  meta: '#7A8594',
  metaMine: '#5A86B0',
  read: '#2F8CF0',
  link: '#1D6FD6',
  accent: '#2F8CF0',
  pillBackground: 'rgba(20, 30, 45, 0.38)',
  pillText: '#FFFFFF',
  highlight: 'rgba(47, 140, 240, 0.18)',
};

// Готовые фоны. Значение в профиле: «preset:<id>» или «photo:<путь в avatars>».
export const WALLPAPERS: { id: string; color: string; dark?: boolean }[] = [
  { id: 'classic', color: '#DCE6F0' },
  { id: 'mint', color: '#D5EDDC' },
  { id: 'sky', color: '#CDE5F8' },
  { id: 'lavender', color: '#E3DDF5' },
  { id: 'peach', color: '#F8E1D4' },
  { id: 'sand', color: '#EFE6D2' },
  { id: 'rose', color: '#F4DCE4' },
  { id: 'night', color: '#2B3445', dark: true },
];

// Цвета имён в групповых чатах — у каждого свой, как в Telegram.
const NAME_COLORS = ['#D9534F', '#E67E22', '#8E44AD', '#27AE60', '#2980B9', '#C0392B', '#16A085', '#D35400'];

export function nameColor(id: string) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return NAME_COLORS[hash % NAME_COLORS.length];
}
