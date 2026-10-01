import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { LANGUAGES, useI18n } from '@/i18n';
import { startAgent, type AgentId } from '@/lib/agents';
import type { Language } from '@/lib/types';

import { Choice } from '../Choice';
import { colors } from '../theme';
import { Button, Card, ErrorText, Field } from '../ui';

// Запуск агента: выбор агента (если их несколько), язык результата, указания.
export function AgentLaunch({
  agents,
  taskId,
  orderId,
  disabled,
  onStarted,
}: {
  agents: { id: AgentId; icon: string }[];
  taskId?: string;
  orderId?: string;
  // Пока не выбрана задача или заказ — кнопка подсказывает, что выбрать.
  disabled?: string;
  onStarted: () => void;
}) {
  const { t } = useI18n();
  const [agent, setAgent] = useState<AgentId>(agents[0].id);
  const [language, setLanguage] = useState<Language | 'client'>('client');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (disabled) {
      setError(disabled);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await startAgent({
        agent,
        taskId,
        orderId,
        instructions,
        language: language === 'client' ? undefined : language,
      });
      setInstructions('');
      onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={styles.title}>{t('agents.launchTitle')}</Text>
      <Text style={styles.muted}>{t('agents.launchHint')}</Text>
      {agents.length > 1 && (
        <Choice
          value={agent}
          onChange={setAgent}
          options={agents.map((a) => ({
            value: a.id,
            label: `${a.icon} ${t(`agents.names.${a.id}`)}`,
            hint: t(`agents.does.${a.id}`),
          }))}
        />
      )}
      <Text style={styles.label}>{t('agents.language')}</Text>
      <Choice
        value={language}
        onChange={setLanguage}
        options={[
          { value: 'client' as const, label: t('agents.clientLanguage') },
          ...LANGUAGES.map(({ code, label }) => ({ value: code, label })),
        ]}
      />
      <Field
        label={t('agents.instructions')}
        hint={t('agents.instructionsHint')}
        multiline
        value={instructions}
        onChangeText={setInstructions}
      />
      <ErrorText>{error}</ErrorText>
      <Button title={`🤖 ${t('agents.start')}`} onPress={start} loading={busy} />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '600', color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  label: { fontSize: 13, color: colors.muted, textTransform: 'uppercase' },
});
