import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { ChatView } from '@/components/ChatView';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import type { Conversation } from '@/lib/teamChat';
import { useChatMessages } from '@/lib/useChatMessages';
import { useAuth } from '@/providers/AuthProvider';

// Беседа внутри команды (общий чат или личная).
export default function TeamChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { profile } = useAuth();
  const { messages, error, send } = useChatMessages(
    { table: 'team_messages', column: 'conversation_id' },
    id,
    profile?.id,
  );
  const [draft, setDraft] = useState('');
  const [conversation, setConversation] = useState<Conversation | null>(null);

  useEffect(() => {
    supabase.rpc('my_conversations').then(({ data }) => {
      setConversation(((data as Conversation[] | null) ?? []).find((c) => c.id === id) ?? null);
    });
  }, [id]);

  // Пока беседа открыта, всё пришедшее считается прочитанным.
  useEffect(() => {
    supabase.rpc('mark_conversation_read', { p_conversation_id: id }).then();
  }, [id, messages.length]);

  const title =
    conversation?.kind === 'team'
      ? t('teamChat.general')
      : (conversation?.other_name ?? t('teamChat.title'));

  return (
    <>
      <Stack.Screen options={{ title }} />
      <ChatView
        messages={messages}
        myId={profile?.id}
        authorLabel={(m) => m.author_name}
        onSend={send}
        error={error}
        draft={draft}
        onDraftChange={setDraft}
      />
    </>
  );
}
