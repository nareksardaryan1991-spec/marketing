import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { agentById } from '@/lib/agents';
import { confirm } from '@/lib/confirm';
import { fileName, pickAndUpload } from '@/lib/files';
import { formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Task } from '@/lib/types';

import { agentLabel } from '../agents/AgentAvatar';
import { NavList, NavRow } from '../NavList';
import { PriorityBadge } from '../PriorityBadge';
import { colors } from '../theme';
import { Button, Card, ErrorText } from '../ui';
import { FileList } from './FileList';
import { taskStyles as styles } from './styles';

// Задание для человека: описание, важность, срок, кто поставил, клиент и файлы.
// Автор и владелец здесь же меняют задачу, прикрепляют файлы и удаляют её.
export function TeamTaskCard({
  task,
  businessName,
  people,
  canEdit,
  onChanged,
}: {
  task: Task;
  businessName: string | null;
  // Имена исполнителя и автора (id → имя).
  people: Record<string, string>;
  // Автор задачи или владелец.
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { t, language } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'upload' | 'delete' | null>(null);

  const run = async (kind: 'upload' | 'delete', action: () => Promise<void>) => {
    setError(null);
    setBusy(kind);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveFiles = async (files: string[]) => {
    const { error } = await supabase.rpc('set_team_task_attachments', { p_task_id: task.id, p_files: files });
    if (error) throw error;
    onChanged();
  };

  const draftAgent = agentById(task.draft_agent);
  const rows: [string, string | null][] = [
    // due_date — день без времени: T12:00, чтобы часовой пояс не сдвинул дату.
    [t('task.dueDate'), task.due_date && formatDate(`${task.due_date}T12:00:00`, language)],
    [t('teamTasks.assignee'), task.assignee_id ? (people[task.assignee_id] ?? '—') : t('task.unassigned')],
    [t('teamTasks.createdBy'), task.created_by ? (people[task.created_by] ?? null) : null],
    [t('teamTasks.client'), businessName],
    [t('teamTasks.description'), task.brief],
    // «Передать человеку»: описание и файлы — черновик этого агента.
    [t('teamTasks.draftBy'), draftAgent ? `🤖 ${agentLabel(t, draftAgent)}` : null],
  ];

  return (
    <Card>
      <View style={styles.row}>
        <Text style={[styles.cardTitle, { flex: 1 }]}>{t('teamTasks.assignment')}</Text>
        <PriorityBadge priority={task.priority} quiet={false} />
      </View>
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <View key={label}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.text}>{value}</Text>
          </View>
        ))}

      {(task.attachments.length > 0 || canEdit) && <Text style={styles.label}>{t('teamTasks.files')}</Text>}
      <FileList paths={task.attachments} />
      {canEdit &&
        task.attachments.map((path) => (
          <View key={path} style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
              {fileName(path)}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => run('upload', () => saveFiles(task.attachments.filter((p) => p !== path)))}>
              <Text style={{ color: colors.danger }}>{t('task.removeFile')}</Text>
            </Pressable>
          </View>
        ))}

      <ErrorText>{error}</ErrorText>
      {canEdit && (
        <>
          <Button
            title={t('task.addFiles')}
            variant="ghost"
            loading={busy === 'upload'}
            onPress={() =>
              run('upload', async () => {
                const uploaded = await pickAndUpload(task.id);
                if (uploaded.length) await saveFiles([...task.attachments, ...uploaded.map((f) => f.path)]);
              })
            }
          />
          {task.related_order_id && (
            <NavList>
              <NavRow icon="cube-outline" title={t('teamTasks.openOrder')} href={`/orders/${task.related_order_id}`} />
            </NavList>
          )}
          <Button title={t('teamTasks.edit')} variant="ghost" onPress={() => router.push(`/team-tasks/edit?id=${task.id}`)} />
          <Button
            title={t('teamTasks.delete')}
            variant="ghost"
            loading={busy === 'delete'}
            onPress={() =>
              run('delete', async () => {
                if (!(await confirm(t('teamTasks.deleteConfirm')))) return;
                const { error } = await supabase.rpc('delete_team_task', { p_task_id: task.id });
                if (error) throw error;
                router.back();
              })
            }
          />
        </>
      )}
    </Card>
  );
}
