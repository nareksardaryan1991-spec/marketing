import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

// Нажатие на push открывает нужный экран.
export function useNotificationTaps(isClient: boolean) {
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    const data = response?.notification.request.content.data as
      | { kind?: string; order_id?: string; task_id?: string; conversation_id?: string }
      | undefined;
    if (!data) return;
    if (data.kind === 'team_chat_message' && data.conversation_id) {
      router.push(`/team-chat/${data.conversation_id}`);
    } else if (data.kind?.endsWith('_message') && data.order_id) {
      router.push(`/orders/${data.order_id}/chat`);
    } else if (!isClient && data.task_id) {
      router.push(`/tasks/${data.task_id}`);
    } else if (data.order_id) {
      router.push(`/orders/${data.order_id}`);
    }
  }, [response, isClient]);
}
