import { useCallback, useEffect, useState } from 'react';

import { supabase } from './supabase';

export type ChatMessage = {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  from_client?: boolean;
};

type Source =
  | { table: 'messages'; column: 'order_id' }
  | { table: 'team_messages'; column: 'conversation_id' };

// Сообщения беседы: загрузка, новые в реальном времени, отправка.
export function useChatMessages(source: Source, id: string, userId: string | undefined) {
  const { table, column } = source;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(
    (message: ChatMessage) =>
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message])),
    [],
  );

  useEffect(() => {
    const load = () =>
      supabase
        .from(table)
        .select('*')
        .eq(column, id)
        .order('created_at')
        .limit(500)
        .then(({ data, error }) => {
          setError(error?.message ?? null);
          if (data) setMessages(data as ChatMessage[]);
        });
    load();
    // Подстраховка к realtime: если соединение пропало, новые сообщения всё равно придут.
    const timer = setInterval(load, 5000);

    const channel = supabase
      .channel(`${table}:${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table, filter: `${column}=eq.${id}` },
        (payload) => add(payload.new as ChatMessage),
      )
      .subscribe();
    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [table, column, id, add]);

  // Возвращает текст ошибки или null.
  const send = useCallback(
    async (body: string): Promise<string | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from(table)
        .insert({ [column]: id, author_id: userId, body })
        .select()
        .single<ChatMessage>();
      if (error) return error.message;
      add(data);
      return null;
    },
    [table, column, id, userId, add],
  );

  return { messages, error, send };
}
