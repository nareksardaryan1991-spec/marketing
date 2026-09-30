import { router } from 'expo-router';
import { useEffect } from 'react';

import { notificationTarget, type NotificationData } from './notificationTarget';

// Нажатие на web push (см. public/sw.js): открытое окно получает сообщение от service worker,
// а новое окно открывается с данными в адресе (?push=...).
export function useNotificationTaps(isClient: boolean) {
  useEffect(() => {
    const open = (data: NotificationData) => {
      const target = notificationTarget(data, isClient);
      if (target) router.push(target);
    };

    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('push');
    if (fromUrl) {
      url.searchParams.delete('push');
      window.history.replaceState(window.history.state, '', url.href);
      try {
        open(JSON.parse(fromUrl));
      } catch {}
    }

    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'notification-click') open(event.data.data ?? {});
    };
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, [isClient]);
}
