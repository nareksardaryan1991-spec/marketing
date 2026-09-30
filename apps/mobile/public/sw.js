// Service worker сайта: показывает web push и открывает приложение по нажатию.
// Лежит в корне сайта (на GitHub Pages — /marketing/sw.js), поэтому видит все его страницы.
// Ничего не кэширует: сайт всегда загружается свежим.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { title: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || 'Marketing', {
      body: msg.body || undefined,
      data: msg.data || {},
      icon: 'icon-192.png',
      badge: 'icon-192.png',
    }),
  );
});

// Нажатие на уведомление: открытое окно приложения получает данные и само откроет нужный
// экран; если окна нет — открываем приложение, а данные передаём в адресе (?push=...).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => w.url.startsWith(self.registration.scope));
      if (open) {
        await open.focus();
        open.postMessage({ type: 'notification-click', data });
        return;
      }
      const url = new URL(self.registration.scope);
      url.searchParams.set('push', JSON.stringify(data));
      await self.clients.openWindow(url.href);
    })(),
  );
});
