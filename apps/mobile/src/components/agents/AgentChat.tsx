import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { askAgent, type AgentId, type AgentRun } from '@/lib/agents';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

import { colors } from '../theme';
import { Button, Card, ErrorText, Field } from '../ui';
import { AgentMessage } from './AgentMessage';

// Чат с агентом: написали, что сделать → «Отправить» → агент сразу делает и отвечает здесь же.
export function AgentChat({ agent }: { agent: Exclude<AgentId, 'manager'> }) {
  const { t } = useI18n();
  const { profile } = useAuth();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const userId = profile?.id;

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('agent_runs')
      .select('*')
      .eq('agent', agent)
      .eq('chat', true)
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) setError(error.message);
    // Старые сверху, новые внизу — как в мессенджере.
    setRuns(((data as AgentRun[] | null) ?? []).reverse());
  }, [agent, userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const anyRunning = runs.some((r) => r.status === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [anyRunning, load]);

  const send = async () => {
    const text = prompt.trim();
    if (!text) return;
    setError(null);
    setSending(true);
    try {
      await askAgent(agent, text);
      setPrompt('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {runs.length === 0 && (
        <Card>
          <Text style={styles.muted}>{t('agents.chatEmpty')}</Text>
          <View style={styles.examples}>
            {(t(`agents.examples.${agent}`) as string).split('|').map((example) => (
              <Pressable
                key={example}
                accessibilityRole="button"
                onPress={() => setPrompt(example)}
                style={styles.example}>
                <Text style={styles.exampleText}>{example}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      )}
      {runs.map((run) => (
        <AgentMessage key={run.id} run={run} onChanged={load} />
      ))}
      <Card>
        <Field
          label={t('agents.chatLabel')}
          hint={t('agents.chatPlaceholder')}
          multiline
          value={prompt}
          onChangeText={setPrompt}
        />
        <ErrorText>{error}</ErrorText>
        <Button title={`➤ ${t('agents.send')}`} onPress={send} loading={sending} />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 15, color: colors.muted },
  examples: { gap: 8 },
  example: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  exampleText: { fontSize: 15, color: colors.text },
});
