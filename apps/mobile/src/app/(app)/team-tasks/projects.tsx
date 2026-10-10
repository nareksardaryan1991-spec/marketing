import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { Button, Card, ErrorText, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { confirm } from '@/lib/confirm';
import { supabase } from '@/lib/supabase';
import type { TeamProject } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

type Row = TeamProject & { tasks: { count: number }[] };

// Проекты задач команды: клиент или направление работы. Заводит, переименовывает, убирает в архив и удаляет
// владелец (так же проверяет база). Архивный проект нельзя выбрать для новой задачи, старые задачи его сохраняют.
// Удалённый проект просто снимается с задач — задачи остаются.
export default function TeamProjectsScreen() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const owner = profile?.role === 'admin';
  const [projects, setProjects] = useState<Row[]>([]);
  const [name, setName] = useState('');
  // Переименование: id проекта и новое название.
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('team_projects').select('*, tasks(count)').order('archived').order('name');
    setError(error?.message ?? null);
    setProjects((data as Row[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const run = async (action: () => PromiseLike<{ error: { message: string } | null }>) => {
    setError(null);
    setBusy(true);
    const { error } = await action();
    setBusy(false);
    if (error) {
      // Повтор названия — понятным текстом (уникальный индекс team_projects_name_idx).
      setError(error.message.includes('team_projects_name_idx') ? t('teamTasks.projects.duplicate') : error.message);
      return false;
    }
    await load();
    return true;
  };

  const add = async () => {
    if (!name.trim()) return;
    if (await run(() => supabase.from('team_projects').insert({ name: name.trim() }))) setName('');
  };

  const rename = async () => {
    if (!editing || !editing.name.trim()) return;
    if (await run(() => supabase.from('team_projects').update({ name: editing.name.trim() }).eq('id', editing.id))) {
      setEditing(null);
    }
  };

  const action = (label: string, onPress: () => void, danger = false) => (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={busy} style={styles.action}>
      <Text style={[styles.actionText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );

  return (
    <Screen>
      <Text style={styles.hint}>{t('teamTasks.projects.hint')}</Text>
      {owner && (
        <Card>
          <Field
            label={t('teamTasks.projects.name')}
            value={name}
            maxLength={80}
            onChangeText={setName}
            onSubmitEditing={add}
          />
          <Button title={t('teamTasks.projects.add')} onPress={add} loading={busy} />
        </Card>
      )}
      <ErrorText>{error}</ErrorText>
      {projects.length === 0 && <Text style={styles.hint}>{t('teamTasks.projects.empty')}</Text>}
      {projects.map((p) => {
        const count = p.tasks[0]?.count ?? 0;
        return (
          <Card key={p.id}>
            {editing?.id === p.id ? (
              <>
                <TextInput
                  value={editing.name}
                  onChangeText={(value) => setEditing({ id: p.id, name: value })}
                  onSubmitEditing={rename}
                  maxLength={80}
                  autoFocus
                  style={styles.input}
                  accessibilityLabel={t('teamTasks.projects.name')}
                />
                <View style={styles.actions}>
                  {action(t('common.save'), rename)}
                  {action(t('common.cancel'), () => setEditing(null))}
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.name, p.archived && styles.archived]}>
                  {p.name}
                  {p.archived ? ` · ${t('teamTasks.projects.archived')}` : ''}
                </Text>
                <Text style={styles.hint}>{t('teamTasks.projects.taskCount', { count })}</Text>
                {owner && (
                  <View style={styles.actions}>
                    {action(t('teamTasks.projects.rename'), () => setEditing({ id: p.id, name: p.name }))}
                    {action(t(p.archived ? 'teamTasks.projects.restore' : 'teamTasks.projects.archive'), () =>
                      run(() => supabase.from('team_projects').update({ archived: !p.archived }).eq('id', p.id)),
                    )}
                    {action(
                      t('teamTasks.delete'),
                      async () => {
                        if (await confirm(t('teamTasks.projects.deleteConfirm', { count }))) {
                          await run(() => supabase.from('team_projects').delete().eq('id', p.id));
                        }
                      },
                      true,
                    )}
                  </View>
                )}
              </>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 14, color: colors.muted },
  name: { fontSize: 17, fontWeight: '600', color: colors.text },
  archived: { color: colors.muted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  action: { paddingVertical: 6 },
  actionText: { fontSize: 15, color: colors.primary, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
});
