import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { askAssistant } from '@/lib/ai';

import { colors } from './theme';
import { Button, Card, ErrorText, Field } from './ui';

// AI-помощник сотрудника: без taskId — «Мой день», с taskId — разбор задачи и вопросы по ней.
// hint — своя подсказка (у задачи команды нет брифа клиента и его правок).
export function AssistantCard({ taskId, hint }: { taskId?: string; hint?: string }) {
  const { t, language } = useI18n();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<'main' | 'ask' | null>(null);

  const run = async (withQuestion: boolean) => {
    setError(null);
    setLoading(withQuestion ? 'ask' : 'main');
    try {
      setAnswer(
        await askAssistant({
          mode: taskId ? 'task' : 'my_day',
          language,
          taskId,
          question: withQuestion ? question : undefined,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card>
      <Text style={styles.title}>{taskId ? t('assistant.taskTitle') : t('assistant.dayTitle')}</Text>
      <Text style={styles.muted}>{hint ?? (taskId ? t('assistant.taskHint') : t('assistant.dayHint'))}</Text>
      <Button
        title={
          loading === 'main'
            ? t('assistant.thinking')
            : taskId
              ? t('assistant.explain')
              : t('assistant.planDay')
        }
        onPress={() => run(false)}
        loading={loading === 'main'}
      />
      {taskId && (
        <>
          <Field
            label={t('assistant.question')}
            hint={t('assistant.questionHint')}
            multiline
            value={question}
            onChangeText={setQuestion}
          />
          {question.trim() !== '' && (
            <Button
              title={loading === 'ask' ? t('assistant.thinking') : t('assistant.ask')}
              variant="ghost"
              onPress={() => run(true)}
              loading={loading === 'ask'}
            />
          )}
        </>
      )}
      <ErrorText>{error}</ErrorText>
      {answer && (
        <View style={styles.answer}>
          <Text selectable style={styles.text}>
            {answer}
          </Text>
          <Text style={styles.muted}>{t('assistant.disclaimer')}</Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '600', color: colors.text },
  text: { fontSize: 15, lineHeight: 22, color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  answer: {
    gap: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
