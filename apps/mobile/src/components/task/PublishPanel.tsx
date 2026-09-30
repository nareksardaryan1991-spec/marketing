import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import type { Task } from '@/lib/types';

import { DateTimeField } from '../DateTimeField';
import { colors } from '../theme';
import { Button, Card, ErrorText, Field } from '../ui';
import { taskStyles as styles } from './styles';

// Дата публикации и отметка «опубликовано». Для команды, а в режиме «клиент публикует» — и для клиента.
export function PublishPanel({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const { t } = useI18n();
  const [publishAt, setPublishAt] = useState<Date | null>(
    task.publish_at ? new Date(task.publish_at) : null,
  );
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'schedule' | 'publish' | null>(null);

  if (task.status === 'published') {
    return (
      <Card>
        <Text style={styles.cardTitle}>{t('publish.published')}</Text>
        {task.published_url ? (
          <Pressable onPress={() => WebBrowser.openBrowserAsync(task.published_url!)}>
            <Text style={{ color: colors.primary }} numberOfLines={1}>
              {task.published_url}
            </Text>
          </Pressable>
        ) : null}
      </Card>
    );
  }

  const schedule = async () => {
    setError(null);
    setBusy('schedule');
    const { error } = await supabase.rpc('schedule_task', {
      p_task_id: task.id,
      p_publish_at: publishAt?.toISOString() ?? null,
    });
    setBusy(null);
    if (error) setError(error.message);
    else onChanged();
  };

  const publish = async () => {
    setError(null);
    setBusy('publish');
    const { error } = await supabase.rpc('mark_published', { p_task_id: task.id, p_url: url });
    setBusy(null);
    if (error) setError(error.message);
    else onChanged();
  };

  const canPublish = task.status === 'approved' || task.status === 'publishing';
  const autoInProgress =
    task.status === 'publishing' && !task.publish_error && !!task.autopublish_state?.container;

  return (
    <Card>
      <Text style={styles.cardTitle}>{t('publish.title')}</Text>
      {task.publish_error ? (
        <Text style={{ color: colors.danger }}>
          {t('publish.autoFailed')}: {task.publish_error}
        </Text>
      ) : null}
      {autoInProgress && <Text style={styles.muted}>{t('publish.autoProcessing')}</Text>}
      <DateTimeField
        label={t('publish.when')}
        mode="datetime"
        value={publishAt}
        onChange={setPublishAt}
      />
      <Button
        title={t('publish.saveDate')}
        variant="ghost"
        onPress={schedule}
        loading={busy === 'schedule'}
      />
      {canPublish && (
        <>
          <Field
            label={t('publish.link')}
            hint="https://instagram.com/p/…"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            keyboardType="url"
          />
          <Button title={t('publish.markPublished')} onPress={publish} loading={busy === 'publish'} />
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
