import { useState } from 'react';
import { Text } from 'react-native';

import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';

import { Button, Card, ErrorText, Field } from '../ui';
import { taskStyles as styles } from './styles';

// Внутренняя проверка менеджером перед отправкой клиенту.
export function ReviewPanel({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const { t } = useI18n();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'approve' | 'return' | null>(null);

  const review = async (approve: boolean) => {
    if (!approve && !comment.trim()) {
      setError(t('task.commentRequired'));
      return;
    }
    setError(null);
    setBusy(approve ? 'approve' : 'return');
    const { error } = await supabase.rpc('review_task', {
      p_task_id: taskId,
      p_approve: approve,
      p_comment: comment,
    });
    setBusy(null);
    if (error) setError(error.message);
    else {
      setComment('');
      onDone();
    }
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>{t('task.reviewTitle')}</Text>
      <Field label={t('task.comment')} multiline value={comment} onChangeText={setComment} />
      <ErrorText>{error}</ErrorText>
      <Button
        title={t('task.sendToClient')}
        onPress={() => review(true)}
        loading={busy === 'approve'}
      />
      <Button
        title={t('task.returnToWork')}
        variant="ghost"
        onPress={() => review(false)}
        loading={busy === 'return'}
      />
    </Card>
  );
}
