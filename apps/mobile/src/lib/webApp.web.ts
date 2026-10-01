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
  addToHead('meta', { name: 'theme-color', content: '#E53935' });
}
