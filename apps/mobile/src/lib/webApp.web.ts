import { Asset } from 'expo-asset';

import { colors, themeName } from '@/components/theme';
import { THEME_FONTS } from '@/components/themeFonts';

// Сайт как приложение: манифест и иконка для «На экран „Домой“». Без манифеста iPhone
// не даёт сайту на экране «Домой» присылать уведомления.
// Теги добавляются при запуске, потому что адрес сайта зависит от сборки:
// на GitHub Pages это подпапка /<репозиторий>, в локальных сборках — корень.
export const webBase = process.env.EXPO_BASE_URL ?? '';

function addToHead(tag: 'link' | 'meta', attrs: Record<string, string>) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.head.appendChild(el);
}

if (typeof document !== 'undefined' && !document.querySelector('link[rel="manifest"]')) {
  addToHead('link', { rel: 'manifest', href: `${webBase}/manifest.webmanifest` });
  addToHead('link', { rel: 'apple-touch-icon', href: `${webBase}/apple-touch-icon.png` });
  addToHead('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  addToHead('meta', { name: 'apple-mobile-web-app-title', content: 'Marketing' });
  addToHead('meta', { name: 'theme-color', content: colors.background });
}

// Основной шрифт сайта — свой у каждого оформления (components/themeFonts.ts). react-native-web пишет у каждого текста без своего шрифта
// «-apple-system, BlinkMacSystemFont, …»; подменяем первый из них нашим файлом, с настоящими
// начертаниями по толщине. Тексты с явным шрифтом (заголовки Unbounded) это не трогает.
// Армянских букв в этих шрифтах нет — браузер берёт их из следующего шрифта списка (системного).
if (typeof document !== 'undefined' && !document.getElementById('app-fonts')) {
  const faces = THEME_FONTS[themeName].body;
  const style = document.createElement('style');
  style.id = 'app-fonts';
  style.textContent = faces
    .map(
      ([font, weight]) =>
        `@font-face{font-family:"-apple-system";src:url("${Asset.fromModule(font).uri}");font-weight:${weight};font-display:swap}`,
    )
    .join('\n');
  document.head.appendChild(style);
}

// Фон страницы под приложением — в цвет оформления (в шаблоне страницы он тёмный).
if (typeof document !== 'undefined') document.body.style.backgroundColor = colors.background;
