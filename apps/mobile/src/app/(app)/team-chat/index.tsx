import { Redirect } from 'expo-router';

// Список бесед команды теперь в общем списке чатов.
export default function TeamChatListScreen() {
  return <Redirect href="/chats" />;
}
