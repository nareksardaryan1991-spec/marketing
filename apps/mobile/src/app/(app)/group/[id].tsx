import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { CheckList } from '@/components/Choice';
import { Screen } from '@/components/Screen';
import { colors, fonts } from '@/components/theme';
import { Button, Card, ErrorText, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { pickProfilePhoto } from '@/lib/avatars';
import { isOnline, lastSeenText, type ChatInfo } from '@/lib/chat';
import { confirm } from '@/lib/confirm';
import { roleLabel } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

// «О группе»: фото, название, участники. Создатель группы и владелец меняют название и фото,
// добавляют и удаляют людей, удаляют группу; остальные видят состав и могут выйти.
// Те же правила проверяет база (0037): кнопки здесь — только для удобства.
export default function GroupInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useI18n();
  const { profile } = useAuth();
  const [info, setInfo] = useState<ChatInfo | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Добавление: коллеги не из группы и отмеченные из них (null — список закрыт).
  const [candidates, setCandidates] = useState<Profile[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('chat_info', { p_chat: 'team', p_chat_id: id });
    if (error) return setError(error.message);
    setInfo(data as ChatInfo);
    setTitle((data as ChatInfo).title ?? '');
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Действие с базой: ошибка — под кнопками, успех — свежие данные.
  const run = async (key: string, action: () => Promise<{ error: { message: string } | null } | void>) => {
    setError(null);
    setBusy(key);
    try {
      const result = await action();
      if (result && result.error) throw new Error(result.error.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!info || !profile) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const manage = !!info.can_manage;
  const members = info.member_list ?? [];
  const memberIds = new Set(members.map((m) => m.id));

  const openAdd = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .not('role', 'in', '(client,pending)')
      .order('full_name');
    if (error) return setError(error.message);
    setPicked([]);
    setCandidates(((data as Profile[] | null) ?? []).filter((p) => !memberIds.has(p.id)));
  };

  const leave = async () => {
    if (!(await confirm(t('chats.leaveConfirm')))) return;
    const { error } = await supabase.rpc('leave_group_chat', { p_conversation_id: id });
    if (error) return setError(error.message);
    router.replace('/chats');
  };

  const remove = async () => {
    if (!(await confirm(t('chats.deleteGroupConfirm')))) return;
    const { error } = await supabase.rpc('delete_group_chat', { p_conversation_id: id });
    if (error) return setError(error.message);
    router.replace('/chats');
  };

  return (
    <Screen>
      <View style={styles.head}>
        <Avatar name={info.avatar_path ? (info.title ?? '?') : '👥'} path={info.avatar_path} size={88} />
        <Text style={styles.title}>{info.title}</Text>
        <Text style={styles.muted}>{t('chats.members', { count: info.members ?? 0 })}</Text>
      </View>

      {manage && (
        <Card>
          <Field label={t('chats.groupName')} value={title} maxLength={80} onChangeText={setTitle} />
          {title.trim() !== (info.title ?? '') && (
            <Button
              title={t('common.save')}
              loading={busy === 'title'}
              onPress={() =>
                run('title', async () => supabase.rpc('rename_group_chat', { p_conversation_id: id, p_title: title }))
              }
            />
          )}
          <Button
            title={info.avatar_path ? t('chats.changeGroupPhoto') : t('chats.addGroupPhoto')}
            variant="ghost"
            loading={busy === 'photo'}
            onPress={() =>
              run('photo', async () => {
                const path = await pickProfilePhoto(profile.id, 'group');
                if (path) return supabase.rpc('set_group_photo', { p_conversation_id: id, p_path: path });
              })
            }
          />
          {!!info.avatar_path && (
            <Button
              title={t('chats.removeGroupPhoto')}
              variant="ghost"
              loading={busy === 'nophoto'}
              onPress={() =>
                run('nophoto', async () => supabase.rpc('set_group_photo', { p_conversation_id: id, p_path: null }))
              }
            />
          )}
        </Card>
      )}

      <Card>
        <Text style={styles.cardTitle}>{t('chats.groupMembers', { count: members.length })}</Text>
        {members.map((m) => {
          const online = isOnline(m.last_seen_at);
          // Владельца удаляет из группы только сам владелец (так же в базе).
          const removable = manage && m.id !== profile.id && (m.role !== 'admin' || profile.role === 'admin');
          return (
            <View key={m.id} style={styles.member}>
              <Avatar name={m.name} path={m.avatar_path} color={m.accent_color} size={40} />
              <View style={styles.memberText}>
                <Text style={styles.memberName}>
                  {m.name}
                  {m.id === profile.id ? ` (${t('chats.you')})` : ''}
                </Text>
                <Text style={styles.muted}>
                  {roleLabel(t, m)}
                  {m.id === info.created_by ? ` · ${t('chats.groupCreator')}` : ''}
                  {' · '}
                  <Text style={online && styles.online}>
                    {online ? t('chats.online') : lastSeenText(m.last_seen_at, language, t)}
                  </Text>
                </Text>
              </View>
              {removable && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('chats.removeMember', { name: m.name })}
                  onPress={async () => {
                    if (!(await confirm(t('chats.removeMemberConfirm', { name: m.name })))) return;
                    run(`remove-${m.id}`, async () =>
                      supabase.rpc('remove_group_member', { p_conversation_id: id, p_user_id: m.id }),
                    );
                  }}>
                  <Text style={styles.removeText}>{t('chats.removeFromGroup')}</Text>
                </Pressable>
              )}
            </View>
          );
        })}

        {manage && !candidates && <Button title={`＋ ${t('chats.addMembers')}`} variant="ghost" onPress={openAdd} />}
        {manage && candidates && (
          <>
            <Text style={styles.label}>{t('chats.addMembers')}</Text>
            {candidates.length === 0 ? (
              <Text style={styles.muted}>{t('chats.everyoneInGroup')}</Text>
            ) : (
              <CheckList
                value={picked}
                onChange={setPicked}
                options={candidates.map((p) => ({
                  value: p.id,
                  label: p.full_name || p.email || '?',
                  hint: roleLabel(t, p),
                }))}
              />
            )}
            {picked.length > 0 && (
              <Button
                title={t('chats.addPicked', { count: picked.length })}
                loading={busy === 'add'}
                onPress={() =>
                  run('add', async () => {
                    const result = await supabase.rpc('add_group_members', { p_conversation_id: id, p_users: picked });
                    if (!result.error) setCandidates(null);
                    return result;
                  })
                }
              />
            )}
            <Button title={t('chats.cancel')} variant="ghost" onPress={() => setCandidates(null)} />
          </>
        )}
      </Card>

      <ErrorText>{error}</ErrorText>
      <Card>
        <Button title={t('chats.leaveGroup')} variant="ghost" onPress={leave} />
        {manage && (
          <>
            <View style={styles.divider} />
            <Button title={t('chats.deleteGroup')} variant="danger" onPress={remove} />
          </>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  title: { fontSize: 20, fontFamily: fonts.display, color: colors.text, textAlign: 'center' },
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 8 },
  muted: { fontSize: 13, color: colors.muted },
  online: { color: colors.primary },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  memberText: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 16, fontWeight: '600', color: colors.text },
  removeText: { color: colors.danger, fontSize: 14 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
});
