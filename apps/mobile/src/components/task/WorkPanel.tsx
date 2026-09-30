import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import type { DraftKind } from '@/lib/ai';
import { fileName, pickAndUpload } from '@/lib/files';
import { fitsFeed, ratioLabel } from '@/lib/imageRules';
import { supabase } from '@/lib/supabase';
import type { Deliverable, Task } from '@/lib/types';

import { colors } from '../theme';
import { Button, Card, ErrorText, Field } from '../ui';
import { AiPanel } from './AiPanel';
import { taskStyles as styles } from './styles';

const AI_KIND_BY_SERVICE: Record<string, DraftKind> = {
  post: 'caption',
  story: 'ideas',
  reel: 'reel_script',
  ads_management: 'ideas',
  video_shoot: 'reel_script',
};

// Рабочее место исполнителя: текст, файлы, AI, отправка на проверку.
export function WorkPanel({
  task,
  lastVersion,
  onChanged,
}: {
  task: Task;
  lastVersion: Deliverable | null;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [caption, setCaption] = useState(lastVersion?.caption ?? '');
  const [files, setFiles] = useState<string[]>(lastVersion?.files ?? []);
  const [note, setNote] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'start' | 'upload' | 'submit' | null>(null);

  const run = async (kind: 'start' | 'upload' | 'submit', action: () => Promise<void>) => {
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

  if (task.status === 'assigned') {
    return (
      <Card>
        <ErrorText>{error}</ErrorText>
        <Button
          title={t('task.start')}
          loading={busy === 'start'}
          onPress={() =>
            run('start', async () => {
              const { error } = await supabase.rpc('start_task', { p_task_id: task.id });
              if (error) throw error;
              onChanged();
            })
          }
        />
      </Card>
    );
  }

  const upload = () =>
    run('upload', async () => {
      const uploaded = await pickAndUpload(task.id);
      setFiles((prev) => [...prev, ...uploaded.map((f) => f.path)]);
      // Для поста в ленте Instagram важны пропорции; истории и рилсы вертикальные — там всё ок.
      if (task.service_id === 'post') {
        const bad = uploaded.filter(
          (f) => f.width && f.height && !fitsFeed(f.width, f.height),
        );
        setWarnings((prev) => [
          ...prev,
          ...bad.map((f) =>
            t('task.ratioWarning', { name: f.name, ratio: ratioLabel(f.width!, f.height!) }),
          ),
        ]);
      }
    });

  const submit = () =>
    run('submit', async () => {
      if (!caption.trim() && files.length === 0) throw new Error(t('task.emptyDeliverable'));
      const { error } = await supabase.rpc('submit_deliverable', {
        p_task_id: task.id,
        p_caption: caption,
        p_files: files,
        p_note: note,
      });
      if (error) throw error;
      setNote('');
      onChanged();
    });

  return (
    <>
      <Card>
        <Text style={styles.cardTitle}>{t('task.workTitle')}</Text>
        <Field label={t('task.caption')} multiline value={caption} onChangeText={setCaption} />
        <Text style={styles.label}>{t('task.files')}</Text>
        {files.map((path) => (
          <View key={path} style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
              {fileName(path)}
            </Text>
            <Pressable onPress={() => setFiles((prev) => prev.filter((p) => p !== path))}>
              <Text style={{ color: colors.danger }}>{t('task.removeFile')}</Text>
            </Pressable>
          </View>
        ))}
        {warnings.map((w) => (
          <Text key={w} style={{ color: colors.danger, fontSize: 14 }}>
            {w}
          </Text>
        ))}
        <Button
          title={t('task.addFiles')}
          variant="ghost"
          onPress={upload}
          loading={busy === 'upload'}
        />
        <Field label={t('task.noteForReviewer')} value={note} onChangeText={setNote} />
        <ErrorText>{error}</ErrorText>
        <Button title={t('task.submit')} onPress={submit} loading={busy === 'submit'} />
      </Card>
      <AiPanel
        taskId={task.id}
        defaultKind={AI_KIND_BY_SERVICE[task.service_id] ?? 'caption'}
        onUse={setCaption}
      />
    </>
  );
}
