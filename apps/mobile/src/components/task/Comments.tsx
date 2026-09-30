import { useState } from 'react';
import { Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { TaskComment } from '@/lib/types';

import { Button, Card, ErrorText, Field } from '../ui';
import { taskStyles as styles } from './styles';

export function Comments({
  taskId,
  userId,
  comments,
  authors,
  onAdded,
}: {
  taskId: string;
  userId: string;
  comments: TaskComment[];
  authors: Record<string, string>;
  onAdded: () => void;
}) {
  const { t, language } = useI18n();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!body.trim()) return;
    setError(null);
    setSending(true);
    const { error } = await supabase
      .from('task_comments')
      .insert({ task_id: taskId, author_id: userId, body: body.trim() });
    setSending(false);
    if (error) setError(error.message);
    else {
      setBody('');
      onAdded();
    }
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>{t('task.comments')}</Text>
      {comments.map((c) => (
        <View key={c.id}>
          <Text style={styles.label}>
            {authors[c.author_id] ?? '—'} · {formatDate(c.created_at, language)}
          </Text>
          <Text style={styles.text}>{c.body}</Text>
        </View>
      ))}
      <Field label={t('task.newComment')} multiline value={body} onChangeText={setBody} />
      <ErrorText>{error}</ErrorText>
      <Button title={t('task.send')} variant="ghost" onPress={send} loading={sending} />
    </Card>
  );
}
