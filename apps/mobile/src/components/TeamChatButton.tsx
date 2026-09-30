import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { playChatSound } from '@/lib/chatSound';
import { supabase } from '@/lib/supabase';
import type { Conversation } from '@/lib/teamChat';

import { colors } from './theme';

// Вход в чат команды на главной, с числом непрочитанных.
export function TeamChatButton() {
  const { t } = useI18n();
  const [unread, setUnread] = useState(0);
  // Сколько было при прошлой проверке; null — ещё не проверяли (без сигнала на старте).
  const previous = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      const load = () =>
        supabase.rpc('my_conversations').then(({ data }) => {
          if (!data) return;
          const total = (data as Conversation[]).reduce((sum, c) => sum + c.unread, 0);
          if (previous.current !== null && total > previous.current) playChatSound();
          previous.current = total;
          setUnread(total);
        });
      load();
      const timer = setInterval(load, 10000);
      return () => clearInterval(timer);
    }, []),
  );

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push('/team-chat')}
      style={styles.button}>
      <Text style={styles.text}>{t('teamChat.title')}</Text>
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  text: { fontSize: 16, fontWeight: '600', color: colors.text },
  badge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.primaryText, fontSize: 13, fontWeight: '700' },
});
