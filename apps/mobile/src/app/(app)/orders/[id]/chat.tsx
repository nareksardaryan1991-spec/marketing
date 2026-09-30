import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { ChatView } from '@/components/ChatView';
import { colors } from '@/components/theme';
import { useI18n } from '@/i18n';
import { invokeFunction } from '@/lib/functions';
import { useChatMessages } from '@/lib/useChatMessages';
import { useAuth } from '@/providers/AuthProvider';
import { isTeamRole } from '@/lib/roles';

// Чат клиента со штатной командой по заказу.
export default function OrderChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { profile } = useAuth();
  const { messages, error, send } = useChatMessages(
    { table: 'messages', column: 'order_id' },
    id,
    profile?.id,
  );
  const [draft, setDraft] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const isTeam = isTeamRole(profile?.role);

  const suggest = async () => {
    setSuggestError(null);
    setSuggesting(true);
    try {
      const { text } = await invokeFunction<{ text: string }>('ai-reply', { order_id: id });
      setDraft(text);
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <ChatView
      messages={messages}
      myId={profile?.id}
      authorLabel={(m) => (m.from_client ? m.author_name : `${m.author_name} · ${t('chat.team')}`)}
      onSend={send}
      error={error ?? suggestError}
      draft={draft}
      onDraftChange={setDraft}
      extraAction={
        isTeam ? (
          <Pressable onPress={suggest} disabled={suggesting} style={styles.suggest}>
            <Text style={styles.suggestText}>
              {suggesting ? t('ai.generating') : t('chat.aiSuggest')}
            </Text>
          </Pressable>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  suggest: { alignSelf: 'flex-start' },
  suggestText: { color: colors.primary, fontWeight: '600' },
});
