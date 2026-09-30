import { useState } from 'react';

import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';

import { Button, ErrorText, Field } from './ui';

export function ClientDecision({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const decide = async (approve: boolean) => {
    if (!approve && !comment.trim()) {
      setError(t('review.commentRequired'));
      return;
    }
    setError(null);
    setBusy(true);
    const { error } = await supabase.rpc('client_decide', {
      p_task_id: taskId,
      p_approve: approve,
      p_comment: comment,
    });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  };

  if (asking) {
    return (
      <>
        <Field
          label={t('review.whatToChange')}
          multiline
          value={comment}
          onChangeText={setComment}
          autoFocus
        />
        <ErrorText>{error}</ErrorText>
        <Button title={t('review.sendChanges')} onPress={() => decide(false)} loading={busy} />
        <Button title={t('common.back')} variant="ghost" onPress={() => setAsking(false)} />
      </>
    );
  }

  return (
    <>
      <ErrorText>{error}</ErrorText>
      <Button title={t('review.approve')} onPress={() => decide(true)} loading={busy} />
      <Button title={t('review.requestChanges')} variant="ghost" onPress={() => setAsking(true)} />
    </>
  );
}
