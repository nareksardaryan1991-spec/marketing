import type { Href } from 'expo-router';

export type NotificationData = {
  kind?: string;
  order_id?: string;
  task_id?: string;
  conversation_id?: string;
};

// Экран, который открывается по нажатию на уведомление.
export function notificationTarget(data: NotificationData, isClient: boolean): Href | null {
  if (data.kind === 'team_chat_message' && data.conversation_id) {
    return `/team-chat/${data.conversation_id}`;
  }
  if (data.kind?.endsWith('_message') && data.order_id) return `/orders/${data.order_id}/chat`;
  if (!isClient && data.task_id) return `/tasks/${data.task_id}`;
  if (data.order_id) return `/orders/${data.order_id}`;
  return null;
}
