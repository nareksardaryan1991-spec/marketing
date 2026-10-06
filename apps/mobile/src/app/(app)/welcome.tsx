import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AgentTag } from '@/components/agents/AgentAvatar';
import { AiDraftBadge } from '@/components/client/AiDraftBadge';
import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { Button, Card } from '@/components/ui';
import { useI18n } from '@/i18n';
import { agentById } from '@/lib/agents';
import type { WelcomeKit } from '@/lib/clientAi';
import { supabase } from '@/lib/supabase';

// Подарок после знакомства: 3 примера постов и контент-план на неделю — черновик AI.
export default function WelcomeScreen() {
  const { t } = useI18n();
  const [kit, setKit] = useState<WelcomeKit | null | undefined>(undefined);
  const [copied, setCopied] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      supabase
        .from('welcome_kits')
        .select('*')
        .maybeSingle<WelcomeKit>()
        .then(({ data }) => setKit(data ?? null));
    }, []),
  );

  if (kit === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!kit?.result) {
    return (
      <Screen>
        <Text style={styles.muted}>{t('welcome.preparing')}</Text>
      </Screen>
    );
  }

  const copy = async (i: number, text: string) => {
    await Clipboard.setStringAsync(text);
    setCopied(i);
  };

  return (
    <Screen>
      <AiDraftBadge />
      <Text style={styles.muted}>{t('welcome.intro')}</Text>

      <AgentTag agent={agentById('smm')!} />
      {kit.result.posts.map((post, i) => (
        <Card key={i}>
          <Text style={styles.label}>{t('welcome.postN', { n: i + 1 })}</Text>
          <Text style={styles.title}>{post.title}</Text>
          <Text selectable style={styles.text}>
            {post.caption}
          </Text>
          <View style={styles.meta}>
            <Text style={styles.metaLabel}>🎨 {t('welcome.imageIdea')}</Text>
            <Text style={styles.metaText}>{post.image_idea}</Text>
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaLabel}>🕒 {t('welcome.bestTime')}</Text>
            <Text style={styles.metaText}>{post.best_time}</Text>
          </View>
          <Button
            title={copied === i ? t('agents.copied') : t('agents.copy')}
            variant="ghost"
            onPress={() => copy(i, post.caption)}
          />
        </Card>
      ))}

      <Card>
        <Text style={styles.title}>{t('welcome.planTitle')}</Text>
        {kit.result.plan.map((item) => (
          <View key={item.day} style={styles.planRow}>
            <Text style={styles.day}>{t(`welcome.days.${item.day}`)}</Text>
            <View style={styles.planText}>
              <Text style={[styles.format, item.format === 'rest' && styles.rest]}>
                {t(`welcome.formats.${item.format}`)}
              </Text>
              <Text style={styles.metaText}>{item.topic}</Text>
            </View>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={styles.muted}>{t('welcome.next')}</Text>
        <Button title={t('order.newOrder')} onPress={() => router.push('/new-order')} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { fontSize: 15, lineHeight: 21, color: colors.muted },
  label: { fontSize: 13, color: colors.muted, textTransform: 'uppercase' },
  title: { fontSize: 18, fontWeight: '600', color: colors.text },
  text: { fontSize: 16, lineHeight: 23, color: colors.text },
  meta: { gap: 2 },
  metaLabel: { fontSize: 13, fontWeight: '600', color: colors.muted },
  metaText: { fontSize: 15, lineHeight: 21, color: colors.text },
  planRow: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  day: { width: 96, fontSize: 15, fontWeight: '600', color: colors.text },
  planText: { flex: 1, gap: 2 },
  format: { fontSize: 13, fontWeight: '600', color: colors.primary, textTransform: 'uppercase' },
  rest: { color: colors.muted },
});
