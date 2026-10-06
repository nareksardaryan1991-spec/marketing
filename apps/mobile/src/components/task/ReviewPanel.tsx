import { useState } from 'react';
import { Text } from 'react-native';

import { useI18n } from '@/i18n';
import { agentById } from '@/lib/agents';
import { supabase } from '@/lib/supabase';
import type { TaskKind } from '@/lib/types';

import { agentLabel } from '../agents/AgentAvatar';
import { Button, Card, ErrorText, Field } from '../ui';
import { taskStyles as styles } from './styles';

// Внутренняя проверка менеджером: работу по заказу — клиенту, задачу команды — принять («Готово»).
export function ReviewPanel({
  taskId,
  kind = 'order',
  agent,
  onDone,
}: {
  taskId: string;
  kind?: TaskKind;
  // Версию сделал AI-агент — напоминаем проверить внимательнее.
  agent?: string | null;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const reviewAgent = agentById(agent);
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
      {reviewAgent ? (
        <Text style={styles.muted}>
          🤖 {t('agents.reviewHint', { name: agentLabel(t, reviewAgent) })}
        </Text>
      ) : null}
      <Field label={t('task.comment')} multiline value={comment} onChangeText={setComment} />
      <ErrorText>{error}</ErrorText>
      <Button
        title={kind === 'team' ? t('teamTasks.accept') : t('task.sendToClient')}
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
