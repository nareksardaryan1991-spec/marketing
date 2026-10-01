import { useLocalSearchParams } from 'expo-router';

import { ChatRoom } from '@/components/chat/ChatRoom';

// Беседа внутри команды (общий чат или личная).
export default function TeamChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatRoom chat="team" id={id} />;
}
