import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { agentById } from '@/lib/agents';
import { startWelcome, type WelcomeKit } from '@/lib/clientAi';
import { supabase } from '@/lib/supabase';

import { AgentAvatar } from '../agents/AgentAvatar';
import { colors } from '../theme';
import { Button, Card, ErrorText } from '../ui';
import { AiDraftBadge } from './AiDraftBadge';

// Подарок после знакомства на главной клиента: пока готовится — «команда пишет»,
// готов — кнопка «Открыть». Клиенты, которые пришли до знакомства, могут попросить его сами.
export function WelcomeKitCard() {
  const { t, language } = useI18n();
  const [kit, setKit] = useState<WelcomeKit | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('welcome_kits').select('*').maybeSingle<WelcomeKit>();
    setKit(data ?? null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Пока команда готовит — проверяем каждые 4 секунды.
  useEffect(() => {
    if (kit?.status !== 'running') return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [kit?.status, load]);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      await startWelcome(language);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  if (kit === undefined) return null;
  const ani = agentById('smm')!;
  const lilit = agentById('designer')!;

  return (
    <Card>
      <View style={styles.head}>
        <View style={styles.avatars}>
          <AgentAvatar agent={ani} size={36} />
          <View style={styles.overlap}>
            <AgentAvatar agent={lilit} size={36} />
          </View>
        </View>
        <Text style={styles.title}>{t('welcome.cardTitle')}</Text>
      </View>

      {kit === null && (
        <>
          <Text style={styles.muted}>{t('welcome.offer')}</Text>
          <Button title={t('welcome.get')} onPress={start} loading={starting} />
        </>
      )}
      {kit?.status === 'running' && (
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>{t('welcome.preparing')}</Text>
        </View>
      )}
      {kit?.status === 'failed' && (
        <>
          <Text style={styles.muted}>{t('welcome.failed')}</Text>
          <Button title={t('common.retry')} variant="ghost" onPress={start} loading={starting} />
        </>
      )}
      {kit?.status === 'done' && kit.result && (
        <>
          <AiDraftBadge />
          <Text style={styles.muted}>
            {t('welcome.ready', { posts: kit.result.posts.length })}
          </Text>
          <Text numberOfLines={2} style={styles.preview}>
            «{kit.result.posts[0]?.title}»
          </Text>
          <Button title={t('welcome.open')} onPress={() => router.push('/welcome')} />
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatars: { flexDirection: 'row' },
  overlap: { marginLeft: -10, borderRadius: 20, borderWidth: 2, borderColor: colors.surface },
  title: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  muted: { fontSize: 15, lineHeight: 21, color: colors.muted },
  preview: { fontSize: 15, color: colors.text, fontStyle: 'italic' },
});
