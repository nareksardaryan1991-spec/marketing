import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  chatColumn,
  chatTable,
  uploadChatFile,
  type Attachment,
  type ChatInfo,
  type ChatMessage,
  type ChatRef,
  type DeletedOriginal,
  type PendingFile,
  type Reaction,
} from './chat';
import { playChatSound } from './chatSound';
import { supabase } from './supabase';
import type { Profile } from './types';

type Presence = { user_id: string; name: string; typing: boolean };

const TYPING_MS = 4000;

function fetchChat(chat: ChatRef['chat'], id: string, isAdmin: boolean) {
  return Promise.all([
    supabase
      .from(chatTable(chat))
      .select('*')
      .eq(chatColumn(chat), id)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase.from('chat_reactions').select('message_id, user_id, user_name, emoji').eq('chat_id', id),
    supabase.rpc('chat_info', { p_chat: chat, p_chat_id: id }),
    isAdmin
      ? supabase.from('deleted_chat_messages').select('message_id, body, attachments').eq('chat_id', id)
      : Promise.resolve({ data: [] as DeletedOriginal[], error: null }),
  ]);
}

// Всё про открытый чат: сообщения, реакции, закреп, «прочитано», кто в сети и печатает,
// и действия. Новое приходит через realtime; раз в 5 секунд — подстраховка запросом.
// Другой чат — другой экземпляр экрана (у встроенного окна свой key), состояние не переносится.
export function useChat(ref: ChatRef, profile: Profile | null) {
  const { chat, id } = ref;
  const userId = profile?.id;
  const isAdmin = profile?.role === 'admin';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [deleted, setDeleted] = useState<Record<string, DeletedOriginal>>({});
  const [info, setInfo] = useState<ChatInfo | null>(null);
  const [present, setPresent] = useState<Presence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Сообщения, которые уже были на экране: сигнал — только о новых и только от других.
  const seen = useRef<Set<string> | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingNow = useRef(false);

  const load = useCallback(
    () =>
      fetchChat(chat, id, isAdmin).then(([m, r, i, d]) => {
        setError(m.error?.message ?? null);
        if (m.data) {
          const list = (m.data as ChatMessage[]).map((x) => ({ ...x, attachments: x.attachments ?? [] })).reverse();
          seen.current ??= new Set(list.map((x) => x.id));
          setMessages(list);
          setLoaded(true);
        }
        if (r.data) setReactions(r.data as Reaction[]);
        if (i.data) setInfo(i.data as ChatInfo);
        if (d.data) {
          setDeleted(Object.fromEntries((d.data as DeletedOriginal[]).map((x) => [x.message_id, x])));
        }
      }),
    [chat, id, isAdmin],
  );

  useEffect(() => {
    if (!seen.current) return;
    const fresh = messages.filter((m) => !seen.current!.has(m.id));
    fresh.forEach((m) => seen.current!.add(m.id));
    if (fresh.some((m) => m.author_id !== userId)) playChatSound();
  }, [messages, userId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    const table = chatTable(chat);
    const channel = supabase.channel(`chat:${chat}:${id}`, {
      config: { presence: { key: userId ?? 'anon' } },
    });
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `${chatColumn(chat)}=eq.${id}` }, () =>
        load(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions', filter: `chat_id=eq.${id}` }, () =>
        load(),
      )
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<Presence>();
        setPresent(Object.values(state).flatMap((entries) => entries.slice(0, 1)));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && userId) {
          channel.track({ user_id: userId, name: profile?.full_name || profile?.email || '', typing: false });
        }
      });
    channelRef.current = channel;
    return () => {
      clearInterval(timer);
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
    // profile?.full_name меняется редко, лишняя переподписка не страшна.
  }, [chat, id, userId, profile?.full_name, profile?.email, load]);

  // Пока чат открыт и приложение на экране, всё пришедшее считается прочитанным.
  const lastId = messages.at(-1)?.id;
  useEffect(() => {
    if (!loaded || AppState.currentState !== 'active') return;
    supabase.rpc('mark_chat_read', { p_chat: chat, p_chat_id: id }).then();
  }, [chat, id, lastId, loaded]);

  const name = profile?.full_name || profile?.email || '';
  const track = useCallback(
    (typing: boolean) => {
      if (!userId || typingNow.current === typing) return;
      typingNow.current = typing;
      channelRef.current?.track({ user_id: userId, name, typing });
    },
    [userId, name],
  );

  // «Печатает…» гаснет само через несколько секунд тишины.
  const setTyping = useCallback(
    (typing: boolean) => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (typing) typingTimer.current = setTimeout(() => track(false), TYPING_MS);
      track(typing);
    },
    [track],
  );

  // Возвращают текст ошибки или null.
  const run = useCallback(
    async (action: () => PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await action();
      if (error) return error.message;
      await load();
      return null;
    },
    [load],
  );

  const send = useCallback(
    async (body: string, files: PendingFile[], replyTo: string | null): Promise<string | null> => {
      if (!userId) return null;
      try {
        const attachments: Attachment[] = [];
        for (const file of files) attachments.push(await uploadChatFile(ref, userId, file));
        setTyping(false);
        return await run(() =>
          supabase.from(chatTable(chat)).insert({
            [chatColumn(chat)]: id,
            author_id: userId,
            body,
            attachments,
            reply_to_id: replyTo,
          }),
        );
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    // ref пересоздаётся на каждом рендере экрана; его поля — chat и id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat, id, userId, run, setTyping],
  );

  // Сообщение-звонок с кнопкой «Присоединиться» для собеседника; собеседнику уходит уведомление.
  const startCall = useCallback(
    async (room: string, video: boolean): Promise<string | null> => {
      if (!userId) return null;
      return run(() =>
        supabase.from(chatTable(chat)).insert({ [chatColumn(chat)]: id, author_id: userId, call: { room, video } }),
      );
    },
    [chat, id, userId, run],
  );

  const edit = useCallback(
    (messageId: string, body: string) =>
      run(() => supabase.rpc('edit_chat_message', { p_chat: chat, p_message_id: messageId, p_body: body })),
    [chat, run],
  );
  const remove = useCallback(
    (messageId: string) =>
      run(() => supabase.rpc('delete_chat_message', { p_chat: chat, p_message_id: messageId })),
    [chat, run],
  );
  const react = useCallback(
    (messageId: string, emoji: string) =>
      run(() => supabase.rpc('react_to_message', { p_chat: chat, p_message_id: messageId, p_emoji: emoji })),
    [chat, run],
  );
  const pin = useCallback(
    (messageId: string | null) =>
      run(() => supabase.rpc('pin_chat_message', { p_chat: chat, p_chat_id: id, p_message_id: messageId })),
    [chat, id, run],
  );
  const forward = useCallback(
    (messageId: string, target: ChatRef) =>
      run(() =>
        supabase.rpc('forward_chat_message', {
          p_from_chat: chat,
          p_message_id: messageId,
          p_to_chat: target.chat,
          p_to_chat_id: target.id,
        }),
      ),
    [chat, run],
  );

  const others = present.filter((p) => p.user_id !== userId);
  return {
    messages,
    reactions,
    deleted,
    info,
    loaded,
    error,
    typingNames: others.filter((p) => p.typing).map((p) => p.name),
    onlineIds: others.map((p) => p.user_id),
    setTyping,
    send,
    startCall,
    edit,
    remove,
    react,
    pin,
    forward,
  };
}
