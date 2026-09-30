import { useState } from 'react';
import { Text, View } from 'react-native';

import { LANGUAGES, useI18n } from '@/i18n';
import { generateDraft, type DraftKind } from '@/lib/ai';
import type { Language } from '@/lib/types';

import { Choice } from '../Choice';
import { Button, Card, ErrorText, Field } from '../ui';
import { taskStyles as styles } from './styles';

const KINDS: DraftKind[] = ['caption', 'ideas', 'reel_script', 'content_plan'];

// AI пишет черновик; человек решает, использовать ли его.
export function AiPanel({
  taskId,
  defaultKind,
  onUse,
}: {
  taskId: string;
  defaultKind: DraftKind;
  onUse: (text: string) => void;
}) {
  const { t, language: uiLanguage } = useI18n();
  const [kind, setKind] = useState<DraftKind>(defaultKind);
  const [language, setLanguage] = useState<Language>(uiLanguage);
  const [instructions, setInstructions] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setError(null);
    setLoading(true);
    try {
      setResult(await generateDraft({ taskId, kind, language, instructions }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>{t('ai.title')}</Text>
      <Text style={styles.muted}>{t('ai.hint')}</Text>
      <Choice
        value={kind}
        onChange={setKind}
        options={KINDS.map((k) => ({ value: k, label: t(`ai.kinds.${k}`) }))}
      />
      <Text style={styles.label}>{t('ai.outputLanguage')}</Text>
      <Choice
        value={language}
        onChange={setLanguage}
        options={LANGUAGES.map(({ code, label }) => ({ value: code, label }))}
      />
      <Field
        label={t('ai.instructions')}
        hint={t('ai.instructionsHint')}
        multiline
        value={instructions}
        onChangeText={setInstructions}
      />
      <ErrorText>{error}</ErrorText>
      <Button
        title={loading ? t('ai.generating') : t('ai.generate')}
        onPress={generate}
        loading={loading}
      />
      {result && (
        <View style={{ gap: 8 }}>
          <Text selectable style={styles.text}>
            {result}
          </Text>
          <Button title={t('ai.use')} variant="ghost" onPress={() => onUse(result)} />
        </View>
      )}
    </Card>
  );
}
