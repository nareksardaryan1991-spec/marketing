import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { notificationTarget, type NotificationData } from './notificationTarget';

// Нажатие на push открывает нужный экран.
export function useNotificationTaps(isClient: boolean) {
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    const data = response?.notification.request.content.data as NotificationData | undefined;
    const target = data && notificationTarget(data, isClient);
    if (target) router.push(target);
  }, [response, isClient]);
}
