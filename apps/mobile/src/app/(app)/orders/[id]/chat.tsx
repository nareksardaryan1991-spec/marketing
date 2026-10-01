import { useLocalSearchParams } from 'expo-router';

import { ChatRoom } from '@/components/chat/ChatRoom';

// Чат клиента со штатной командой по заказу.
export default function OrderChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatRoom chat="order" id={id} />;
}
