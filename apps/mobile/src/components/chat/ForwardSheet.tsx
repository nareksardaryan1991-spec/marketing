import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useI18n } from '@/i18n';
import type { ChatListItem, ChatRef } from '@/lib/chat';
import { supabase } from '@/lib/supabase';

import { chatColors } from './chatTheme';
import { ChatRow, chatTitle } from './ChatRow';
import { colors } from '@/components/theme';

// «Переслать в…»: любой из своих чатов, с поиском.
export function ForwardSheet({
  visible,
  myId,
  isClient,
  onPick,
  onClose,
}: {
  visible: boolean;
  myId: string | undefined;
  isClient: boolean;
  onPick: (target: ChatRef) => void;
  onClose: () => void;
}) {
  const { t, language } = useI18n();
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!visible) return;
    supabase.rpc('my_chats').then(({ data }) => setChats((data as ChatListItem[] | null) ?? []));
  }, [visible]);

  const close = () => {
    setQuery('');
    onClose();
  };

  const needle = query.trim().toLowerCase();
  const shown = chats.filter((c) => !needle || chatTitle(c, isClient, t, language).toLowerCase().includes(needle));

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('chats.forwardTo')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('chats.close')} onPress={close}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('chats.search')}
            placeholderTextColor={chatColors.meta}
            style={styles.search}
          />
          <ScrollView style={styles.list}>
            {shown.map((item) => (
              <ChatRow
                key={`${item.chat}:${item.id}`}
                item={item}
                myId={myId}
                isClient={isClient}
                compact
                onPress={() => {
                  setQuery('');
                  onPick({ chat: item.chat, id: item.id });
                }}
              />
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 12,
    paddingBottom: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: chatColors.text },
  close: { fontSize: 20, color: chatColors.meta, padding: 4 },
  search: {
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: colors.surfaceAlt,
    color: chatColors.text,
  },
  list: { flexGrow: 0 },
});
