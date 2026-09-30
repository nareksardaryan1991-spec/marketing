import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { Button, Card, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Conversation } from '@/lib/teamChat';
import type { Profile } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

// Чат команды: общий чат штатных сотрудников и личные беседы.
export default function TeamChatListScreen() {
  const { t, language } = useI18n();
  const { profile } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [colleagues, setColleagues] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    supabase.rpc('my_conversations').then(({ data, error }) => {
      setError(error?.message ?? null);
      setConversations((data as Conversation[] | null) ?? []);
    });
  }, []);

  useFocusEffect(load);

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
    if (error) {
      setError(error.message);
      return;
    }
    setColleagues(null);
    router.push(`/team-chat/${data as string}`);
  };

  const title = (c: Conversation) =>
    c.kind === 'team' ? t('teamChat.general') : (c.other_name ?? '—');

  return (
    <Screen>
      <ErrorText>{error}</ErrorText>
      <Card>
        {conversations.length === 0 && <Text style={styles.muted}>{t('teamChat.empty')}</Text>}
        {conversations.map((c, i) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            onPress={() => router.push(`/team-chat/${c.id}`)}
            style={[styles.row, i === 0 && styles.firstRow]}>
            <View style={styles.rowText}>
              <View style={styles.titleRow}>
                <Text style={[styles.name, c.unread > 0 && styles.nameUnread]} numberOfLines={1}>
                  {title(c)}
                </Text>
                {c.kind === 'direct' && c.other_role && (
                  <Text style={styles.role}>{t(`roles.${c.other_role}`)}</Text>
                )}
              </View>
              <Text style={styles.muted} numberOfLines={1}>
                {c.last_body
                  ? `${c.kind === 'team' && c.last_author ? `${c.last_author}: ` : ''}${c.last_body}`
                  : t('teamChat.noMessages')}
              </Text>
            </View>
            <View style={styles.meta}>
              {c.last_message_at && (
                <Text style={styles.date}>{formatDate(c.last_message_at, language)}</Text>
              )}
              {c.unread > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{c.unread}</Text>
                </View>
              )}
            </View>
          </Pressable>
        ))}
      </Card>

      {colleagues ? (
        <Card>
          <Text style={styles.cardTitle}>{t('teamChat.pickColleague')}</Text>
          {colleagues.map((person) => (
            <Pressable
              key={person.id}
              accessibilityRole="button"
              onPress={() => openDirect(person.id)}
              style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.name}>{person.full_name || person.email}</Text>
                <Text style={styles.muted}>{t(`roles.${person.role}`)}</Text>
              </View>
            </Pressable>
          ))}
          <Button title={t('common.back')} variant="ghost" onPress={() => setColleagues(null)} />
        </Card>
      ) : (
        <Button title={t('teamChat.newDirect')} onPress={pickColleague} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  firstRow: { borderTopWidth: 0 },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name: { flexShrink: 1, fontSize: 16, fontWeight: '500', color: colors.text },
  nameUnread: { fontWeight: '700' },
  role: { fontSize: 13, color: colors.muted },
  muted: { fontSize: 14, color: colors.muted },
  meta: { alignItems: 'flex-end', gap: 4 },
  date: { fontSize: 12, color: colors.muted },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.primaryText, fontSize: 12, fontWeight: '700' },
});
