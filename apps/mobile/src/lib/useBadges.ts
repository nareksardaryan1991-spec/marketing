import { useEffect, useRef, useState } from 'react';

import type { ChatListItem } from './chat';
import { playChatSound } from './chatSound';
import { supabase } from './supabase';

// Счётчики для значков на нижнем меню. Обновляются, пока приложение открыто.

// Непрочитанные во всех чатах; при новых — короткий звук (на старте без сигнала).
export function useUnreadChats(enabled: boolean): number {
  const [unread, setUnread] = useState(0);
  const previous = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const load = () =>
      supabase.rpc('my_chats').then(({ data }) => {
        if (!data) return;
        const total = (data as ChatListItem[]).reduce((sum, c) => sum + c.unread, 0);
        if (previous.current !== null && total > previous.current) playChatSound();
        previous.current = total;
        setUnread(total);
      });
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [enabled]);

  return unread;
}

// Для клиента: сколько материалов ждут его решения.
export function useWaitingApprovals(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const load = () =>
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'client_review')
        .then(({ count }) => setCount(count ?? 0));
    load();
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, [enabled]);

  return count;
}
