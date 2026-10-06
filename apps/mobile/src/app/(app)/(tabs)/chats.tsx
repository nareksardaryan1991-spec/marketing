import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { ChatRoom } from '@/components/chat/ChatRoom';
import { ChatRow, chatTitle } from '@/components/chat/ChatRow';
import { chatColors } from '@/components/chat/chatTheme';
import { useI18n } from '@/i18n';
import { chatHref, type ChatListItem, type ChatRef } from '@/lib/chat';
import { isEmployeeRole, roleLabel } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

// Шире — список слева и открытый чат справа, как в Telegram на компьютере.
const SPLIT = 900;

// Все чаты человека: заказы, общий чат команды и личные беседы.
export default function ChatsScreen() {
  const { t, language } = useI18n();
  const { profile } = useAuth();
  const isClient = profile?.role === 'client';
  const split = useWindowDimensions().width >= SPLIT;
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ChatRef | null>(null);
  const [colleagues, setColleagues] = useState<Profile[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      const load = () =>
        supabase.rpc('my_chats').then(({ data, error }) => {
          setError(error?.message ?? null);
          if (data) setChats(data as ChatListItem[]);
        });
      load();
      const timer = setInterval(load, 5000);
      return () => clearInterval(timer);
    }, []),
  );

  const open = (ref: ChatRef) => {
    if (split) setSelected(ref);
    else router.push(chatHref(ref));
  };

  const pickColleague = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .not('role', 'in', '(client,pending)')
      .neq('id', profile?.id ?? '')
      .order('full_name');
    if (error) setError(error.message);
    else setColleagues((data as Profile[] | null) ?? []);
  };

  const openDirect = async (userId: string) => {
    const { data, error } = await supabase.rpc('open_direct_conversation', { p_user_id: userId });
    setColleagues(null);
    if (error) setError(error.message);
    else open({ chat: 'team', id: data as string });
  };

  const needle = query.trim().toLowerCase();
  const shown = chats.filter(
    (c) =>
      !needle ||
      chatTitle(c, isClient, t, language).toLowerCase().includes(needle) ||
      (c.last_body ?? '').toLowerCase().includes(needle),
  );

  const list = (
    <View style={split ? styles.listPaneSplit : styles.listPane}>
      <View style={styles.toolbar}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('chats.search')}
          placeholderTextColor={chatColors.meta}
          style={styles.search}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chats.wallpaper')}
          onPress={() => router.push('/profile')}
          style={styles.toolButton}>
          <Text style={styles.toolIcon}>🎨</Text>
        </Pressable>
        {isEmployeeRole(profile?.role) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chats.newChat')}
            onPress={pickColleague}
            style={styles.toolButton}>
            <Text style={styles.toolIcon}>✏️</Text>
          </Pressable>
        )}
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <ScrollView>
        {shown.length === 0 &&
          (isClient && !query ? (
            <EmptyState
              icon="💬"
              text={t('chats.emptyClient')}
              action={t('order.newOrder')}
              onAction={() => router.push('/new-order')}
            />
          ) : (
            <Text style={styles.empty}>{t('chats.empty')}</Text>
          ))}
        {shown.map((item) => (
          <ChatRow
            key={`${item.chat}:${item.id}`}
            item={item}
            myId={profile?.id}
            isClient={isClient}
            selected={selected?.chat === item.chat && selected.id === item.id}
            onPress={() => open({ chat: item.chat, id: item.id })}
          />
        ))}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      {split ? (
        <View style={styles.split}>
          {list}
          <View style={styles.roomPane}>
            {selected ? (
              <ChatRoom key={`${selected.chat}:${selected.id}`} chat={selected.chat} id={selected.id} embedded />
            ) : (
              <View style={styles.placeholder}>
                <Text style={styles.placeholderText}>{t('chats.selectChat')}</Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        list
      )}

      <Modal transparent animationType="fade" visible={!!colleagues} onRequestClose={() => setColleagues(null)}>
        <Pressable style={styles.backdrop} onPress={() => setColleagues(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{t('teamChat.pickColleague')}</Text>
            <ScrollView>
              {(colleagues ?? []).map((person) => (
                <Pressable
                  key={person.id}
                  accessibilityRole="button"
                  onPress={() => openDirect(person.id)}
                  style={({ pressed }) => [styles.person, pressed && styles.personPressed]}>
                  <Avatar name={person.full_name || person.email || '?'} path={person.avatar_path} color={person.accent_color} size={40} />
                  <View style={styles.personText}>
                    <Text style={styles.personName}>{person.full_name || person.email}</Text>
                    <Text style={styles.personRole}>{roleLabel(t, person)}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  split: { flex: 1, flexDirection: 'row' },
  listPane: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  listPaneSplit: { width: 360, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#E1E3EA' },
  roomPane: { flex: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10 },
  search: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: '#F1F3F7',
    color: chatColors.text,
  },
  toolButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  toolIcon: { fontSize: 18 },
  error: { color: '#DC2626', paddingHorizontal: 12, fontSize: 13 },
  empty: { textAlign: 'center', color: chatColors.meta, marginTop: 40, fontSize: 15 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DCE6F0' },
  placeholderText: {
    color: chatColors.pillText,
    backgroundColor: chatColors.pillBackground,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 14,
    overflow: 'hidden',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 380, maxHeight: '75%', backgroundColor: '#FFFFFF', borderRadius: 16, paddingVertical: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: chatColors.text, paddingHorizontal: 16, paddingBottom: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  personPressed: { backgroundColor: '#F1F3F7' },
  personText: { flex: 1 },
  personName: { fontSize: 16, fontWeight: '600', color: chatColors.text },
  personRole: { fontSize: 13, color: chatColors.meta },
});
