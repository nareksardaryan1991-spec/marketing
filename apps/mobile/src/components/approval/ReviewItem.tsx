import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useI18n } from '@/i18n';
import { autoApproveOn, formatSeconds, isVideo, previewKind } from '@/lib/approvals';
import { formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Deliverable, Task } from '@/lib/types';

import { HumanCheckBadge } from '../HumanCheckBadge';
import { colors } from '../theme';
import { Button, Card, ErrorText, Field } from '../ui';
import type { NumberedMark } from './MarkDots';
import { PostPreview } from './PostPreview';

export type ReviewTask = Task & { deliverables: Deliverable[] };

// Материал на согласовании: превью «как в Instagram», одобрить или попросить правки
// комментарием и точками на кадре.
export function ReviewItem({
  task,
  title,
  name,
  avatarUrl,
  urls,
  autoDays,
  onDone,
}: {
  task: ReviewTask;
  title: string;
  name: string;
  avatarUrl: string | null;
  urls: Record<string, string>;
  autoDays: number;
  onDone: () => void;
}) {
  const { t, language } = useI18n();
  const [changes, setChanges] = useState(false);
  const [marks, setMarks] = useState<NumberedMark[]>([]);
  // Секунда видео, введённая вручную (в приложении видео играет вне превью).
  const [secText, setSecText] = useState<Record<number, string>>({});
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const latest = [...task.deliverables].sort((a, b) => b.version - a.version)[0];
  const deadline = autoApproveOn(task.client_review_since, autoDays);

  const decide = async (approve: boolean) => {
    const cleaned = marks.map(({ n, ...m }) => {
      const typed = Number((secText[n] ?? '').replace(',', '.'));
      return {
        ...m,
        note: m.note.trim(),
        at_seconds: m.at_seconds ?? (secText[n] && Number.isFinite(typed) && typed >= 0 ? typed : null),
      };
    });
    if (!approve) {
      if (cleaned.some((m) => !m.note)) return setError(t('approvals.markNoteRequired'));
      if (!comment.trim() && cleaned.length === 0) return setError(t('approvals.changesRequired'));
    }
    setError(null);
    setBusy(true);
    const { error } = await supabase.rpc('client_decide', {
      p_task_id: task.id,
      p_approve: approve,
      p_comment: approve ? null : comment,
      p_marks: approve ? null : cleaned,
    });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  };

  const updateMark = (n: number, patch: Partial<NumberedMark>) =>
    setMarks((list) => list.map((m) => (m.n === n ? { ...m, ...patch } : m)));

  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.title}>{title}</Text>
        {latest && latest.version > 1 ? (
          <Text style={styles.muted}>{t('approvals.version', { version: latest.version })}</Text>
        ) : null}
      </View>
      {latest?.sent_to_client_at ? <HumanCheckBadge name={latest.reviewer_name} /> : null}
      {deadline ? (
        <Text style={styles.deadline}>
          {deadline.daysLeft <= 0
            ? t('approvals.autoToday')
            : t('approvals.autoIn', {
                count: deadline.daysLeft,
                date: formatDate(deadline.date, language),
              })}
        </Text>
      ) : null}

      <PostPreview
        kind={previewKind(task.service_id ?? '')}
        name={name}
        avatarUrl={avatarUrl}
        files={latest?.files ?? []}
        urls={urls}
        caption={latest?.caption ?? null}
        marks={marks}
        placeLabel={t('approvals.markMoment')}
        onPlace={
          changes
            ? (file_path, x, y, seconds) =>
                setMarks((list) => [
                  ...list,
                  {
                    n: (list.at(-1)?.n ?? 0) + 1,
                    file_path,
                    x,
                    y,
                    at_seconds: seconds,
                    note: '',
                  },
                ])
            : undefined
        }
      />

      {changes ? (
        <>
          <Text style={styles.hint}>{t('approvals.markHint')}</Text>
          {marks.map((m) => (
            <View key={m.n} style={styles.mark}>
              <View style={styles.markHead}>
                <Text style={styles.markN}>📍 {m.n}</Text>
                {isVideo(m.file_path) &&
                  (m.at_seconds != null ? (
                    <Text style={styles.muted}>{formatSeconds(m.at_seconds)}</Text>
                  ) : (
                    <TextInput
                      value={secText[m.n] ?? ''}
                      onChangeText={(v) => setSecText((all) => ({ ...all, [m.n]: v }))}
                      placeholder={t('approvals.second')}
                      placeholderTextColor={colors.muted}
                      keyboardType="numeric"
                      style={styles.seconds}
                    />
                  ))}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('approvals.removeMark')}
                  onPress={() => setMarks((list) => list.filter((x) => x.n !== m.n))}
                  style={styles.remove}>
                  <Text style={styles.removeText}>✕</Text>
                </Pressable>
              </View>
              <TextInput
                value={m.note}
                onChangeText={(note) => updateMark(m.n, { note })}
                placeholder={t('approvals.markNote')}
                placeholderTextColor={colors.muted}
                autoFocus
                multiline
                style={styles.note}
              />
            </View>
          ))}
          <Field
            label={t('review.whatToChange')}
            multiline
            value={comment}
            onChangeText={setComment}
          />
          <ErrorText>{error}</ErrorText>
          <Button title={t('review.sendChanges')} onPress={() => decide(false)} loading={busy} />
          <Button
            title={t('common.back')}
            variant="ghost"
            onPress={() => {
              setChanges(false);
              setMarks([]);
              setError(null);
            }}
          />
        </>
      ) : (
        <>
          <ErrorText>{error}</ErrorText>
          <Button title={t('review.approve')} onPress={() => decide(true)} loading={busy} />
          <Button title={t('review.requestChanges')} variant="ghost" onPress={() => setChanges(true)} />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  deadline: { fontSize: 13, color: '#9D174D' },
  hint: { fontSize: 14, color: colors.muted },
  mark: { gap: 6, padding: 10, borderRadius: 12, backgroundColor: '#FEF2F2' },
  markHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  markN: { fontWeight: '700', color: '#B91C1C' },
  seconds: {
    width: 90,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  remove: { marginLeft: 'auto', padding: 4 },
  removeText: { fontSize: 16, color: colors.muted },
  note: {
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 8,
    backgroundColor: colors.surface,
    color: colors.text,
  },
});
