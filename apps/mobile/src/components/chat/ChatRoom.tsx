import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { useI18n } from '@/i18n';
import {
  chatFileUrls,
  dayLabel,
  daysAgo,
  isOnline,
  lastSeenText,
  messagePreview,
  type Attachment,
  type ChatMessage,
  type ChatRef,
  type PendingFile,
} from '@/lib/chat';
import { newCallRoom, openCall } from '@/lib/calls';
import { invokeFunction } from '@/lib/functions';
import { isTeamRole } from '@/lib/roles';
import { useChat } from '@/lib/useChat';
import { useAuth } from '@/providers/AuthProvider';

import { ChatBackground } from './ChatBackground';
import { chatColors, nameColor } from './chatTheme';
import { Composer, type ComposerBanner } from './Composer';
import { ForwardSheet } from './ForwardSheet';
import { MediaViewer } from './MediaViewer';
import { MessageBubble, type ReactionGroup } from './MessageBubble';
import { MessageMenu, type MenuAction } from './MessageMenu';

const GROUP_GAP_MS = 10 * 60 * 1000;
const COLUMN = 760;

function confirm(message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  return new Promise((resolve) =>
    Alert.alert(message, undefined, [
      { text: '✕', style: 'cancel', onPress: () => resolve(false) },
      { text: 'OK', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

// Окно чата: шапка с собеседником, закреп, лента на фоне, поле ввода.
// embedded — внутри списка чатов на широком экране (шапка своя, а не в навигации).
export function ChatRoom({ chat, id, embedded }: ChatRef & { embedded?: boolean }) {
  const { t, language } = useI18n();
  const { profile } = useAuth();
  const ref = useMemo<ChatRef>(() => ({ chat, id }), [chat, id]);
  const room = useChat(ref, profile);
  const { messages, reactions, deleted, info } = room;
  const myId = profile?.id;
  const isClient = profile?.role === 'client';
  const isAdmin = profile?.role === 'admin';
  const wide = useWindowDimensions().width >= 700;

  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [forwardFor, setForwardFor] = useState<ChatMessage | null>(null);
  const [viewer, setViewer] = useState<{ photos: Attachment[]; index: number } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [suggesting, setSuggesting] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const scrolledOnce = useRef(false);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Ссылки на все файлы ленты (и удалённые оригиналы — для владельца).
  const pathsKey = useMemo(
    () =>
      [
        ...messages.flatMap((m) => m.attachments.map((a) => a.path)),
        ...Object.values(deleted).flatMap((d) => d.attachments.map((a) => a.path)),
      ].join('|'),
    [messages, deleted],
  );
  useEffect(() => {
    if (!pathsKey) return;
    chatFileUrls(pathsKey.split('|')).then(setUrls).catch(() => {});
  }, [pathsKey]);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const reactionGroups = useMemo(() => {
    const groups = new Map<string, ReactionGroup[]>();
    for (const r of reactions) {
      const list = groups.get(r.message_id) ?? [];
      let group = list.find((g) => g.emoji === r.emoji);
      if (!group) {
        group = { emoji: r.emoji, count: 0, mine: false, names: [] };
        list.push(group);
      }
      group.count += 1;
      group.mine ||= r.user_id === myId;
      group.names.push(r.user_name);
      groups.set(r.message_id, list);
    }
    return groups;
  }, [reactions, myId]);
  const myReaction = menuFor
    ? reactions.find((r) => r.message_id === menuFor.id && r.user_id === myId)?.emoji
    : undefined;

  // ---------- Шапка ----------
  const teamGeneral = chat === 'team' && info?.members != null;
  const direct = chat === 'team' && !teamGeneral;
  const title = teamGeneral
    ? t('teamChat.general')
    : chat === 'order' && isClient
      ? t('chats.agency')
      : (info?.title ?? '');
  const peerOnline =
    (!!info?.peer?.id && room.onlineIds.includes(info.peer.id)) ||
    (chat === 'order' && isClient && room.onlineIds.length > 0) ||
    isOnline(info?.peer?.last_seen_at);
  const subtitle = room.typingNames.length
    ? direct
      ? t('chats.typing')
      : t('chats.typingName', { name: room.typingNames[0] })
    : teamGeneral
      ? t('chats.members', { count: info?.members ?? 0 })
      : info
        ? peerOnline
          ? t('chats.online')
          : lastSeenText(info.peer?.last_seen_at, language, t)
        : '';
  const subtitleActive = room.typingNames.length > 0 || (!teamGeneral && peerOnline);
  const header = (
    <View style={styles.headerTitle}>
      <Avatar
        name={teamGeneral ? '👥' : title || '?'}
        path={teamGeneral || isClient ? null : info?.peer?.avatar_path}
        size={36}
      />
      <View style={styles.headerText}>
        <Text style={styles.headerName} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={[styles.headerStatus, subtitleActive && styles.headerStatusActive]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  );

  // Звонок: окно Jitsi открываем сразу по нажатию (иначе браузер заблокирует вкладку),
  // сообщение в чат — следом.
  const myName = profile?.full_name || profile?.email || '';
  const call = async (video: boolean) => {
    const callRoom = newCallRoom();
    openCall(callRoom, video, myName).catch(() => {});
    setActionError(await room.startCall(callRoom, video));
  };
  const joinCall = useCallback(
    (c: { room: string; video: boolean }) => {
      openCall(c.room, c.video, myName).catch(() => {});
    },
    [myName],
  );
  const callButtons = (
    <View style={styles.callButtons}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('chats.audioCall')} onPress={() => call(false)} style={styles.callButton}>
        <Text style={styles.callIcon}>📞</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('chats.videoCall')} onPress={() => call(true)} style={styles.callButton}>
        <Text style={styles.callIcon}>🎥</Text>
      </Pressable>
    </View>
  );

  const authorLabel = useCallback(
    (m: ChatMessage) => {
      if (m.author_id === myId) return t('chats.you');
      if (chat === 'order' && isClient && !m.from_client) return `${m.author_name} · ${t('chat.team')}`;
      return m.author_name;
    },
    [chat, isClient, myId, t],
  );

  // ---------- Прокрутка ----------
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    setNearBottom(contentSize.height - contentOffset.y - layoutMeasurement.height < 160);
  };
  const lastMine = messages.at(-1)?.author_id === myId;
  const onContentSizeChange = () => {
    if (!scrolledOnce.current || nearBottom || lastMine) {
      listRef.current?.scrollToEnd({ animated: scrolledOnce.current });
      if (messages.length > 0) scrolledOnce.current = true;
    }
  };
  const jumpTo = useCallback(
    (messageId: string) => {
      const index = messages.findIndex((m) => m.id === messageId);
      if (index < 0) return;
      listRef.current?.scrollToIndex({ index, viewPosition: 0.4, animated: true });
      setHighlight(messageId);
      setTimeout(() => setHighlight((current) => (current === messageId ? null : current)), 1600);
    },
    [messages],
  );

  // ---------- Действия ----------
  const onSend = async () => {
    if (editing) {
      const failure = await room.edit(editing.id, draft.trim());
      if (!failure) {
        setEditing(null);
        setDraft('');
      }
      return failure;
    }
    const failure = await room.send(draft.trim(), files, replyTo?.id ?? null);
    if (!failure) {
      setDraft('');
      setFiles([]);
      setReplyTo(null);
      listRef.current?.scrollToEnd({ animated: true });
    }
    return failure;
  };

  const onSendVoice = async (file: PendingFile) => {
    const failure = await room.send('', [file], replyTo?.id ?? null);
    if (!failure) setReplyTo(null);
    return failure;
  };

  const report = (failure: string | null) => setActionError(failure);

  const onMenuAction = async (action: MenuAction) => {
    const message = menuFor;
    setMenuFor(null);
    if (!message) return;
    switch (action) {
      case 'reply':
        setEditing(null);
        setReplyTo(message);
        break;
      case 'forward':
        setForwardFor(message);
        break;
      case 'copy':
        await Clipboard.setStringAsync(message.body);
        setNotice(t('chats.copied'));
        break;
      case 'edit':
        setReplyTo(null);
        setFiles([]);
        setEditing(message);
        setDraft(message.body);
        break;
      case 'pin':
        report(await room.pin(message.id));
        break;
      case 'unpin':
        report(await room.pin(null));
        break;
      case 'delete':
        if (await confirm(t('chats.deleteConfirm'))) report(await room.remove(message.id));
        break;
    }
  };

  const reactTo = room.react;
  const onReact = useCallback(
    async (message: ChatMessage, emoji: string) => {
      setMenuFor(null);
      setActionError(await reactTo(message.id, emoji));
    },
    [reactTo],
  );

  const onForward = async (target: ChatRef) => {
    const message = forwardFor;
    setForwardFor(null);
    if (!message) return;
    const failure = await room.forward(message.id, target);
    setActionError(failure);
    if (!failure) setNotice(t('chats.forwarded'));
  };

  const suggest = async () => {
    setActionError(null);
    setSuggesting(true);
    try {
      const { text } = await invokeFunction<{ text: string }>('ai-reply', { order_id: id });
      setDraft(text);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  };

  const banner: ComposerBanner = editing
    ? { icon: '✏️', title: t('chats.editing'), text: messagePreview(editing, t) }
    : replyTo
      ? { icon: '↩️', title: t('chats.replyTo', { name: authorLabel(replyTo) }), text: messagePreview(replyTo, t) }
      : null;

  const renderItem = ({ item, index }: { item: ChatMessage; index: number }) => {
    const prev = messages[index - 1];
    const newDay = !prev || daysAgo(prev.created_at) !== daysAgo(item.created_at);
    const firstInGroup =
      newDay ||
      prev.author_id !== item.author_id ||
      new Date(item.created_at).getTime() - new Date(prev.created_at).getTime() > GROUP_GAP_MS;
    const mine = item.author_id === myId;
    const reply = item.reply_to_id ? byId.get(item.reply_to_id) : undefined;
    return (
      <View style={firstInGroup && !newDay && styles.groupGap}>
        {newDay && (
          <View style={styles.dayPill}>
            <Text style={styles.dayText}>{dayLabel(item.created_at, language, t)}</Text>
          </View>
        )}
        <MessageBubble
          message={item}
          mine={mine}
          showAuthor={!mine && !direct && firstInGroup}
          authorLabel={authorLabel(item)}
          authorColor={nameColor(item.author_id)}
          replyTo={reply}
          replyAuthor={reply ? authorLabel(reply) : ''}
          reactions={reactionGroups.get(item.id) ?? []}
          read={!!info?.others_read_at && info.others_read_at >= item.created_at}
          original={deleted[item.id]}
          urls={urls}
          highlighted={highlight === item.id}
          onMenu={setMenuFor}
          onReact={onReact}
          onOpenPhoto={(photos, i) => setViewer({ photos, index: i })}
          onJumpTo={jumpTo}
          onJoinCall={joinCall}
          onSwipeReply={(m) => {
            if (m.deleted_at) return;
            setEditing(null);
            setReplyTo(m);
          }}
        />
      </View>
    );
  };

  const column = wide ? styles.column : null;

  return (
    <View style={styles.screen}>
      {embedded ? (
        <View style={styles.embeddedHeader}>
          {header}
          {callButtons}
        </View>
      ) : (
        <Stack.Screen options={{ headerTitle: () => header, headerRight: () => callButtons }} />
      )}
      <ChatBackground value={profile?.chat_wallpaper}>
        <SafeAreaView style={styles.flex} edges={embedded ? [] : ['bottom']}>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
            {info?.pinned && (
              <Pressable accessibilityRole="button" onPress={() => jumpTo(info.pinned!.id)} style={styles.pinned}>
                <View style={styles.pinnedBar} />
                <View style={styles.pinnedText}>
                  <Text style={styles.pinnedTitle}>{t('chats.pinned')}</Text>
                  <Text style={styles.pinnedBody} numberOfLines={1}>
                    {messagePreview(info.pinned, t)}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('chats.unpin')}
                  onPress={async () => report(await room.pin(null))}>
                  <Text style={styles.pinnedClose}>✕</Text>
                </Pressable>
              </Pressable>
            )}
            {(room.error || actionError) && <Text style={styles.error}>{room.error ?? actionError}</Text>}

            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(m) => m.id}
              renderItem={renderItem}
              extraData={[urls, highlight, info?.others_read_at, reactionGroups, deleted]}
              style={styles.flex}
              contentContainerStyle={[styles.list, column]}
              onScroll={onScroll}
              scrollEventThrottle={100}
              onContentSizeChange={onContentSizeChange}
              onScrollToIndexFailed={(failed) => {
                listRef.current?.scrollToOffset({ offset: failed.averageItemLength * failed.index });
                setTimeout(() => listRef.current?.scrollToIndex({ index: failed.index, viewPosition: 0.4 }), 200);
              }}
              ListEmptyComponent={
                room.loaded ? (
                  <View style={styles.dayPill}>
                    <Text style={styles.dayText}>{t('chat.empty')}</Text>
                  </View>
                ) : null
              }
            />

            {!nearBottom && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('chats.jumpDown')}
                onPress={() => listRef.current?.scrollToEnd({ animated: true })}
                style={styles.down}>
                <Text style={styles.downText}>⌄</Text>
              </Pressable>
            )}
            {notice && (
              <View style={styles.toast}>
                <Text style={styles.toastText}>{notice}</Text>
              </View>
            )}

            <View style={styles.composerBar}>
              <View style={column}>
                <Composer
                  draft={draft}
                  onDraftChange={setDraft}
                  files={files}
                  onFilesChange={setFiles}
                  banner={banner}
                  onCancelBanner={() => {
                    if (editing) setDraft('');
                    setEditing(null);
                    setReplyTo(null);
                  }}
                  editing={!!editing}
                  onSend={onSend}
                  onSendVoice={onSendVoice}
                  onTyping={() => room.setTyping(true)}
                  extra={
                    chat === 'order' && isTeamRole(profile?.role) ? (
                      <Pressable onPress={suggest} disabled={suggesting} style={styles.suggest}>
                        <Text style={styles.suggestText}>
                          {suggesting ? t('ai.generating') : t('chat.aiSuggest')}
                        </Text>
                      </Pressable>
                    ) : undefined
                  }
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </ChatBackground>

      <MessageMenu
        message={menuFor}
        canEdit={!!menuFor && menuFor.author_id === myId && !menuFor.deleted_at}
        canDelete={!!menuFor && (menuFor.author_id === myId || isAdmin) && !menuFor.deleted_at}
        isPinned={!!menuFor && info?.pinned?.id === menuFor.id}
        myReaction={myReaction}
        onReact={(emoji) => menuFor && onReact(menuFor, emoji)}
        onAction={onMenuAction}
        onClose={() => setMenuFor(null)}
      />
      <ForwardSheet
        visible={!!forwardFor}
        myId={myId}
        isClient={isClient}
        onPick={onForward}
        onClose={() => setForwardFor(null)}
      />
      {viewer && (
        <MediaViewer
          photos={viewer.photos}
          index={viewer.index}
          urls={urls}
          onIndex={(index) => setViewer({ ...viewer, index })}
          onClose={() => setViewer(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  column: { width: '100%', maxWidth: COLUMN, alignSelf: 'center' },
  embeddedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E1E3EA',
    backgroundColor: '#FFFFFF',
  },
  callButtons: { flexDirection: 'row', gap: 4, marginRight: 4 },
  callButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  callIcon: { fontSize: 20 },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 420 },
  headerText: { flexShrink: 1 },
  headerName: { fontSize: 16, fontWeight: '700', color: chatColors.text },
  headerStatus: { fontSize: 13, color: chatColors.meta },
  headerStatusActive: { color: chatColors.accent },
  pinned: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E1E3EA',
  },
  pinnedBar: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: chatColors.accent },
  pinnedText: { flex: 1 },
  pinnedTitle: { fontSize: 13, fontWeight: '700', color: chatColors.accent },
  pinnedBody: { fontSize: 13, color: chatColors.text },
  pinnedClose: { fontSize: 16, color: chatColors.meta, padding: 4 },
  error: { color: '#DC2626', backgroundColor: '#FFFFFF', padding: 8, fontSize: 13 },
  list: { paddingVertical: 10, flexGrow: 1 },
  groupGap: { marginTop: 6 },
  dayPill: {
    alignSelf: 'center',
    marginVertical: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: chatColors.pillBackground,
  },
  dayText: { color: chatColors.pillText, fontSize: 13, fontWeight: '600' },
  down: {
    position: 'absolute',
    right: 16,
    bottom: 86,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  downText: { fontSize: 22, color: chatColors.meta, marginTop: -8 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 90,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(20, 30, 45, 0.85)',
  },
  toastText: { color: '#FFFFFF', fontSize: 14 },
  composerBar: { alignSelf: 'stretch', width: '100%', backgroundColor: '#FFFFFF' },
  suggest: { alignSelf: 'flex-start', paddingHorizontal: 6 },
  suggestText: { color: chatColors.accent, fontWeight: '600' },
});
