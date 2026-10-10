import { storage } from '@/lib/storage';

// Четыре оформления на выбор в «Профиле» (буквы — варианты из макетов):
//  dark   — «B, тёмный премиум»: почти чёрный фон, салатовый акцент, заголовки Unbounded;
//  bright — «C, яркий дружелюбный»: светлый фон, коралловый акцент, пастельные плашки, шрифт Manrope;
//  bold   — «F, смелый игровой»: толстые чёрные обводки, жёсткие тени, жёлтый/розовый/мятный/синий, Rubik;
//  story  — «G, как сторис»: тёмный, коралловый акцент, Onest; материалы одобряются как сторис, свайпом.
// Выбор читается из памяти устройства при запуске: стили во всём приложении собираются один раз,
// поэтому после смены оформления приложение перезапускается (см. setThemeName).
export type ThemeName = 'dark' | 'bright' | 'bold' | 'story';
export const THEME_NAMES: ThemeName[] = ['dark', 'bright', 'bold', 'story'];
const STORAGE_KEY = 'app.theme';

const dark = {
  colors: {
    background: '#0E0F11',
    surface: '#18191D',
    // Второй уровень: поля внутри карточек, нажатая строка, дорожки прогресса, сегменты.
    surfaceAlt: '#222329',
    text: '#F2F2F0',
    muted: '#9A9CA5',
    border: '#2A2C31',
    primary: '#C8F135',
    // Текст на акцентном цвете: на салатовом — тёмный.
    primaryText: '#0E0F11',
    danger: '#FF7A6B',
    dangerText: '#0E0F11',
    success: '#7EE0A2',
    warning: '#FFB547',
    // Нижнее меню, рамка просроченной карточки, фон просроченной и непрочитанной строки.
    tabBar: '#1F2125',
    dangerBorder: '#4A2420',
    dangerSurface: '#1F1717',
    accentSurface: '#1C1F17',
  },
  // Плашки статусов: тёмный фон оттенка + светлый текст того же оттенка.
  tints: {
    neutral: { bg: '#26272C', fg: '#C4C6CC' },
    accent: { bg: '#2A3312', fg: '#C8F135' },
    green: { bg: '#1D3326', fg: '#7EE0A2' },
    amber: { bg: '#3A2E17', fg: '#FFB547' },
    orange: { bg: '#3A2416', fg: '#FF9F5A' },
    red: { bg: '#3A1D1A', fg: '#FF8F80' },
    blue: { bg: '#182C3D', fg: '#7CC4FF' },
    violet: { bg: '#2B2440', fg: '#B9A4FF' },
    pink: { bg: '#3D1A2A', fg: '#FF8FB8' },
    teal: { bg: '#123331', fg: '#6EE0CF' },
  },
  fonts: {
    display: 'Unbounded_600SemiBold',
    regular: 'GolosText_400Regular',
    medium: 'GolosText_500Medium',
    semibold: 'GolosText_600SemiBold',
    bold: 'GolosText_700Bold',
  },
  // Чаты в духе Telegram: свои сообщения справа, чужие слева.
  chat: {
    mine: '#2B3318',
    theirs: '#1F2125',
    text: '#F2F2F0',
    meta: '#8A8D96',
    metaMine: '#A3AE7E',
    read: '#C8F135',
    link: '#C8F135',
    accent: '#C8F135',
    accentText: '#0E0F11',
    pillBackground: 'rgba(0, 0, 0, 0.5)',
    pillText: '#FFFFFF',
    highlight: 'rgba(200, 241, 53, 0.15)',
    quote: 'rgba(200, 241, 53, 0.08)',
    quoteMine: 'rgba(200, 241, 53, 0.14)',
    reaction: '#2A2C31',
    reactionBorder: 'rgba(255, 255, 255, 0.06)',
    voiceBar: '#4A4D55',
    voiceBarMine: '#5C6640',
    callIcon: '#2A2C31',
    photo: 'rgba(255, 255, 255, 0.06)',
    // Пустой экран справа от списка чатов на компьютере.
    placeholder: '#121316',
    names: ['#FF8F80', '#FFB547', '#B9A4FF', '#7EE0A2', '#7CC4FF', '#FF8FB8', '#6EE0CF', '#FF9F5A'],
  },
  // Готовые фоны чата; id одни и те же в обоих оформлениях — выбор пользователя сохраняется.
  wallpapers: [
    { id: 'classic', color: '#121316', dark: true },
    { id: 'mint', color: '#0F1C16', dark: true },
    { id: 'sky', color: '#0F1823', dark: true },
    { id: 'lavender', color: '#18152A', dark: true },
    { id: 'peach', color: '#22170F', dark: true },
    { id: 'sand', color: '#1E1A10', dark: true },
    { id: 'rose', color: '#22121A', dark: true },
    { id: 'night', color: '#2B3445', dark: true },
  ] as { id: string; color: string; dark?: boolean }[],
  // Узор поверх фона чата: насколько заметен светлый узор на тёмном фоне.
  patternOpacity: 0.2,
  chart: { deemphasis: '#4A4D55', up: '#7EE0A2' },
  isDark: true,
  // Обводка и тень карточек и кнопок (только у «смелого» оформления).
  outline: null as null | { borderWidth: number; borderColor: string; boxShadow: string; smallShadow: string },
  // Одобрение материалов «как сторис» — главный способ на экране «Одобрить».
  storyApprovals: false,
};

const bright: typeof dark = {
  colors: {
    background: '#F6F4FA',
    surface: '#FFFFFF',
    surfaceAlt: '#EEEAF4',
    text: '#1B1530',
    muted: '#6A6480',
    border: '#E4DFEE',
    primary: '#C2381B',
    primaryText: '#FFFFFF',
    danger: '#B42318',
    dangerText: '#FFFFFF',
    success: '#1E6B3E',
    warning: '#8A5A00',
    tabBar: '#FFFFFF',
    dangerBorder: '#FFC9BF',
    dangerSurface: '#FFF5F3',
    accentSurface: '#FFF3EF',
  },
  tints: {
    neutral: { bg: '#EEEAF4', fg: '#4A4560' },
    accent: { bg: '#FFE4DC', fg: '#9C2C14' },
    green: { bg: '#DFF5EA', fg: '#1E6B3E' },
    amber: { bg: '#FFF4C7', fg: '#7A5A00' },
    orange: { bg: '#FFE9DC', fg: '#A3410F' },
    red: { bg: '#FFE4E0', fg: '#B02E14' },
    blue: { bg: '#E2F0FF', fg: '#1D5FA8' },
    violet: { bg: '#EEE8FF', fg: '#5B3BB5' },
    pink: { bg: '#FCE7EF', fg: '#A61E50' },
    teal: { bg: '#DDF4F0', fg: '#11695C' },
  },
  fonts: {
    display: 'Manrope_800ExtraBold',
    regular: 'Manrope_500Medium',
    medium: 'Manrope_600SemiBold',
    semibold: 'Manrope_700Bold',
    bold: 'Manrope_800ExtraBold',
  },
  chat: {
    mine: '#FFE4DC',
    theirs: '#FFFFFF',
    text: '#1B1530',
    meta: '#6A6480',
    metaMine: '#A0574A',
    read: '#C2381B',
    link: '#C2381B',
    accent: '#C2381B',
    accentText: '#FFFFFF',
    pillBackground: 'rgba(27, 21, 48, 0.38)',
    pillText: '#FFFFFF',
    highlight: 'rgba(194, 56, 27, 0.12)',
    quote: 'rgba(194, 56, 27, 0.06)',
    quoteMine: 'rgba(194, 56, 27, 0.1)',
    reaction: '#FFFFFF',
    reactionBorder: 'rgba(27, 21, 48, 0.08)',
    voiceBar: '#D5D0E0',
    voiceBarMine: '#F2B8AA',
    callIcon: '#FFE4DC',
    photo: 'rgba(27, 21, 48, 0.06)',
    placeholder: '#EEEAF4',
    names: ['#C2381B', '#A3410F', '#5B3BB5', '#1E6B3E', '#1D5FA8', '#A61E50', '#11695C', '#7A5A00'],
  },
  wallpapers: [
    { id: 'classic', color: '#EEEAF4' },
    { id: 'mint', color: '#DFF5EA' },
    { id: 'sky', color: '#E2F0FF' },
    { id: 'lavender', color: '#EEE8FF' },
    { id: 'peach', color: '#FFE9DC' },
    { id: 'sand', color: '#FFF4C7' },
    { id: 'rose', color: '#FCE7EF' },
    { id: 'night', color: '#2B3445', dark: true },
  ],
  patternOpacity: 0.6,
  chart: { deemphasis: '#C3C2B7', up: '#1E6B3E' },
  isDark: false,
  outline: null,
  storyApprovals: false,
};

const bold: typeof dark = {
  colors: {
    background: '#F7F5F0',
    surface: '#FFFFFF',
    surfaceAlt: '#F0EDE4',
    text: '#111111',
    muted: '#4A4A4A',
    border: '#111111',
    primary: '#2443E0',
    primaryText: '#FFFFFF',
    danger: '#D1361F',
    dangerText: '#FFFFFF',
    success: '#0E7A4C',
    warning: '#8A5A00',
    tabBar: '#FFFFFF',
    dangerBorder: '#D1361F',
    dangerSurface: '#FFE9E5',
    accentSurface: '#EEF1FF',
  },
  // Яркие плашки с чёрным текстом.
  tints: {
    neutral: { bg: '#F0EDE4', fg: '#111111' },
    accent: { bg: '#C9D3FF', fg: '#111111' },
    green: { bg: '#7DE2B8', fg: '#111111' },
    amber: { bg: '#FFD43B', fg: '#111111' },
    orange: { bg: '#FFB27A', fg: '#111111' },
    red: { bg: '#FFB4A8', fg: '#111111' },
    blue: { bg: '#C9D3FF', fg: '#111111' },
    violet: { bg: '#D9C9FF', fg: '#111111' },
    pink: { bg: '#FF8FC7', fg: '#111111' },
    teal: { bg: '#9FE8DA', fg: '#111111' },
  },
  fonts: {
    display: 'Rubik_800ExtraBold',
    regular: 'Rubik_400Regular',
    medium: 'Rubik_500Medium',
    semibold: 'Rubik_600SemiBold',
    bold: 'Rubik_700Bold',
  },
  chat: {
    mine: '#C9D3FF',
    theirs: '#FFFFFF',
    text: '#111111',
    meta: '#4A4A4A',
    metaMine: '#3A4A8A',
    read: '#2443E0',
    link: '#2443E0',
    accent: '#2443E0',
    accentText: '#FFFFFF',
    pillBackground: 'rgba(17, 17, 17, 0.6)',
    pillText: '#FFFFFF',
    highlight: 'rgba(36, 67, 224, 0.12)',
    quote: 'rgba(36, 67, 224, 0.06)',
    quoteMine: 'rgba(17, 17, 17, 0.08)',
    reaction: '#FFD43B',
    reactionBorder: '#111111',
    voiceBar: '#C8C4B8',
    voiceBarMine: '#8FA0E8',
    callIcon: '#FFD43B',
    photo: 'rgba(17, 17, 17, 0.06)',
    placeholder: '#F0EDE4',
    names: ['#D1361F', '#A3410F', '#5B3BB5', '#0E7A4C', '#2443E0', '#A61E50', '#11695C', '#7A5A00'],
  },
  wallpapers: [
    { id: 'classic', color: '#F7F5F0' },
    { id: 'mint', color: '#DDF7EC' },
    { id: 'sky', color: '#E3E9FF' },
    { id: 'lavender', color: '#EDE5FF' },
    { id: 'peach', color: '#FFE7D6' },
    { id: 'sand', color: '#FFF3C2' },
    { id: 'rose', color: '#FFE0EF' },
    { id: 'night', color: '#2B3445', dark: true },
  ],
  patternOpacity: 0.6,
  chart: { deemphasis: '#C8C4B8', up: '#0E7A4C' },
  isDark: false,
  outline: { borderWidth: 2, borderColor: '#111111', boxShadow: '4px 4px 0px #111111', smallShadow: '2px 2px 0px #111111' },
  storyApprovals: false,
};

const story: typeof dark = {
  colors: {
    background: '#0B0B0C',
    surface: '#1A1A1E',
    surfaceAlt: '#26262C',
    text: '#FFFFFF',
    muted: '#A0A0A8',
    border: '#2E2E35',
    primary: '#FF5A3C',
    primaryText: '#140603',
    danger: '#FF6B95',
    dangerText: '#140603',
    success: '#2BD67B',
    warning: '#FFC53D',
    tabBar: '#1A1A1E',
    dangerBorder: '#4A2030',
    dangerSurface: '#1F1418',
    accentSurface: '#22150F',
  },
  tints: {
    neutral: { bg: '#26262C', fg: '#C8C8D0' },
    accent: { bg: '#3A1F18', fg: '#FF8A70' },
    green: { bg: '#123222', fg: '#2BD67B' },
    amber: { bg: '#3A2E10', fg: '#FFC53D' },
    orange: { bg: '#3A2416', fg: '#FF9F5A' },
    red: { bg: '#3A1A26', fg: '#FF8FB0' },
    blue: { bg: '#182C3D', fg: '#7CC4FF' },
    violet: { bg: '#2B2440', fg: '#B9A4FF' },
    pink: { bg: '#3D1A2A', fg: '#FF8FB8' },
    teal: { bg: '#123331', fg: '#6EE0CF' },
  },
  fonts: {
    display: 'Onest_800ExtraBold',
    regular: 'Onest_400Regular',
    medium: 'Onest_500Medium',
    semibold: 'Onest_600SemiBold',
    bold: 'Onest_700Bold',
  },
  chat: {
    mine: '#3A1F18',
    theirs: '#1E1E22',
    text: '#FFFFFF',
    meta: '#8A8A92',
    metaMine: '#C98E80',
    read: '#FF5A3C',
    link: '#FF8A70',
    accent: '#FF5A3C',
    accentText: '#140603',
    pillBackground: 'rgba(0, 0, 0, 0.55)',
    pillText: '#FFFFFF',
    highlight: 'rgba(255, 90, 60, 0.16)',
    quote: 'rgba(255, 90, 60, 0.08)',
    quoteMine: 'rgba(255, 90, 60, 0.14)',
    reaction: '#26262C',
    reactionBorder: 'rgba(255, 255, 255, 0.06)',
    voiceBar: '#4A4A52',
    voiceBarMine: '#7A4436',
    callIcon: '#26262C',
    photo: 'rgba(255, 255, 255, 0.06)',
    placeholder: '#111113',
    names: ['#FF8A70', '#FFC53D', '#B9A4FF', '#2BD67B', '#7CC4FF', '#FF8FB8', '#6EE0CF', '#FF9F5A'],
  },
  wallpapers: dark.wallpapers,
  patternOpacity: 0.16,
  chart: { deemphasis: '#4A4A52', up: '#2BD67B' },
  isDark: true,
  outline: null,
  storyApprovals: true,
};

function savedThemeName(): ThemeName {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (THEME_NAMES.includes(saved as ThemeName)) return saved as ThemeName;
  } catch {
    // хранилище недоступно — оформление по умолчанию
  }
  return 'dark';
}

export const themeName: ThemeName = savedThemeName();
export const theme = { dark, bright, bold, story }[themeName];
export const { colors, tints, fonts } = theme;

// Обводка и жёсткая тень «смелого» оформления; в остальных — пусто. Добавляется в стили карточек и кнопок.
export const outlined = theme.outline
  ? { borderWidth: theme.outline.borderWidth, borderColor: theme.outline.borderColor, boxShadow: theme.outline.boxShadow }
  : {};
export const outlinedSmall = theme.outline
  ? { borderWidth: theme.outline.borderWidth, borderColor: theme.outline.borderColor, boxShadow: theme.outline.smallShadow }
  : {};

// Запомнить выбор. Применится после перезапуска: в браузере перезагружаем страницу сами,
// в приложении на телефоне — при следующем открытии. Возвращает true, если перезагрузили.
export function setThemeName(name: ThemeName): boolean {
  try {
    storage?.setItem(STORAGE_KEY, name);
  } catch {
    return false;
  }
  if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
    window.location.reload();
    return true;
  }
  return false;
}

// Цвет текста поверх произвольного цвета (например, цвета из кабинета): на светлом — тёмный, на тёмном — белый.
export function textOn(background: string) {
  const hex = background.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return colors.text;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? '#14151A' : '#FFFFFF';
}
