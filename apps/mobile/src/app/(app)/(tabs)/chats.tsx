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
import { CheckList } from '@/components/Choice';
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
import { colors } from '@/components/theme';

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
  // Новая группа: название и отмеченные коллеги (null — выбираем, кому написать лично).
  const [newGroup, setNewGroup] = useState<{ title: string; members: string[] } | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  const closePicker = () => {
    setColleagues(null);
    setNewGroup(null);
    setGroupError(null);
  };

  const createGroup = async () => {
    if (!newGroup) return;
    if (!newGroup.title.trim()) return setGroupError(t('chats.groupNameRequired'));
    if (newGroup.members.length === 0) return setGroupError(t('chats.groupMembersRequired'));
    setCreating(true);
    const { data, error } = await supabase.rpc('create_group_chat', {
      p_title: newGroup.title,
      p_members: newGroup.members,
    });
    setCreating(false);
    if (error) return setGroupError(error.message);
    closePicker();
    open({ chat: 'team', id: data as string });
  };

  const openDirect = async (userId: string) => {
    const { data, error } = await supabase.rpc('open_direct_conversation', { p_user_id: userId });
    closePicker();
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

      <Modal transparent animationType="fade" visible={!!colleagues} onRequestClose={closePicker}>
        <Pressable style={styles.backdrop} onPress={closePicker}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {newGroup ? (
              <>
                <Text style={styles.sheetTitle}>{t('chats.newGroup')}</Text>
                <TextInput
                  value={newGroup.title}
                  onChangeText={(title) => {
                    setGroupError(null);
                    setNewGroup({ ...newGroup, title });
                  }}
                  placeholder={t('chats.groupName')}
                  placeholderTextColor={chatColors.meta}
                  maxLength={80}
                  autoFocus
                  style={[styles.search, styles.groupName]}
                />
                <Text style={styles.sheetLabel}>{t('chats.groupMembers', { count: newGroup.members.length })}</Text>
                <ScrollView contentContainerStyle={styles.groupList}>
                  <CheckList
                    value={newGroup.members}
                    onChange={(members) => {
                      setGroupError(null);
                      setNewGroup({ ...newGroup, members });
                    }}
                    options={(colleagues ?? []).map((person) => ({
                      value: person.id,
                      label: person.full_name || person.email || '?',
                      hint: roleLabel(t, person),
                    }))}
                  />
                </ScrollView>
                {!!groupError && <Text style={styles.error}>{groupError}</Text>}
                <View style={styles.sheetActions}>
                  <Pressable accessibilityRole="button" onPress={() => setNewGroup(null)} style={styles.sheetButton}>
                    <Text style={styles.sheetButtonText}>{t('chats.back')}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={creating}
                    onPress={createGroup}
                    style={[styles.sheetButton, styles.sheetButtonPrimary, creating && styles.disabled]}>
                    <Text style={[styles.sheetButtonText, styles.sheetButtonTextPrimary]}>{t('chats.createGroup')}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.sheetTitle}>{t('teamChat.pickColleague')}</Text>
                <ScrollView>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setNewGroup({ title: '', members: [] })}
                    style={({ pressed }) => [styles.person, pressed && styles.personPressed]}>
                    <Avatar name="👥" size={40} />
                    <View style={styles.personText}>
                      <Text style={[styles.personName, styles.newGroup]}>{t('chats.newGroup')}</Text>
                      <Text style={styles.personRole}>{t('chats.newGroupHint')}</Text>
                    </View>
                  </Pressable>
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
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  split: { flex: 1, flexDirection: 'row' },
  listPane: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  listPaneSplit: { width: 360, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  roomPane: { flex: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10 },
  search: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: colors.surface,
    color: chatColors.text,
  },
  toolButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  toolIcon: { fontSize: 18 },
  error: { color: colors.danger, paddingHorizontal: 12, fontSize: 13 },
  empty: { textAlign: 'center', color: chatColors.meta, marginTop: 40, fontSize: 15 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: chatColors.placeholder },
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
  sheet: { width: '100%', maxWidth: 380, maxHeight: '75%', backgroundColor: colors.surface, borderRadius: 22, paddingVertical: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: chatColors.text, paddingHorizontal: 16, paddingBottom: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  personPressed: { backgroundColor: colors.surfaceAlt },
  personText: { flex: 1 },
  personName: { fontSize: 16, fontWeight: '600', color: chatColors.text },
  personRole: { fontSize: 13, color: chatColors.meta },
  newGroup: { color: chatColors.accent },
  groupName: { flex: 0, marginHorizontal: 16, marginBottom: 8 },
  sheetLabel: { fontSize: 13, color: chatColors.meta, paddingHorizontal: 16, paddingBottom: 6 },
  groupList: { paddingHorizontal: 16, paddingBottom: 8 },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 16, paddingTop: 8 },
  sheetButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  sheetButtonPrimary: { backgroundColor: chatColors.accent },
  sheetButtonText: { fontSize: 15, fontWeight: '600', color: chatColors.accent },
  sheetButtonTextPrimary: { color: chatColors.accentText },
  disabled: { opacity: 0.6 },
});
