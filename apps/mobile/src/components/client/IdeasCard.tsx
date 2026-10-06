import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { agentById } from '@/lib/agents';
import { acceptIdea, currentWeekStart, dismissIdea, startIdeas, type TaskIdea } from '@/lib/clientAi';
import { formatAmd, localized } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Localized } from '@/lib/types';

import { AgentAvatar } from '../agents/AgentAvatar';
import { colors } from '../theme';
import { Button, Card, ErrorText } from '../ui';

type Offer = { platform: string | null; service: string; price: number | null; label: Localized | null };

// Идеи задач от агентов на эту неделю. Раз в неделю их готовит AI по профилю бизнеса;
// «Принять» создаёт заказ из одной позиции и открывает его для оплаты.
export function IdeasCard() {
  const { t, language } = useI18n();
  const [ideas, setIdeas] = useState<TaskIdea[]>([]);
  const [batch, setBatch] = useState<'none' | 'running' | 'done' | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [names, setNames] = useState<Record<string, { name: Localized; price: number }>>({});
  const [platforms, setPlatforms] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(false);
  const week = currentWeekStart();

  const load = useCallback(async () => {
    const [batchRes, ideasRes] = await Promise.all([
      supabase.from('idea_batches').select('status').eq('week_start', week).maybeSingle(),
      supabase.from('task_ideas').select('*').eq('week_start', week).order('created_at'),
    ]);
    setBatch((batchRes.data?.status as 'running' | 'done' | undefined) ?? 'none');
    setIdeas((ideasRes.data as TaskIdea[] | null) ?? []);
  }, [week]);

  useFocusEffect(
    useCallback(() => {
      load();
      Promise.all([
        supabase.from('services').select('id, name, price_amd'),
        supabase.from('platform_services').select('platform_id, service_id, price_amd, label'),
        supabase.from('platforms').select('id, name'),
      ]).then(([s, ps, p]) => {
        setNames(Object.fromEntries((s.data ?? []).map((x) => [x.id, { name: x.name, price: x.price_amd }])));
        setOffers(
          (ps.data ?? []).map((x) => ({ platform: x.platform_id, service: x.service_id, price: x.price_amd, label: x.label })),
        );
        setPlatforms(Object.fromEntries((p.data ?? []).map((x) => [x.id, x.name])));
      });
    }, [load]),
  );

  // Идей на эту неделю ещё нет — просим команду (один раз за показ экрана; ошибку не показываем:
  // без AI на сервере блок просто не появится).
  useEffect(() => {
    if (batch !== 'none' || asked.current) return;
    asked.current = true;
    startIdeas(language)
      .then(load)
      .catch(() => {});
  }, [batch, language, load]);

  useEffect(() => {
    if (batch !== 'running') return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [batch, load]);

  const accept = async (idea: TaskIdea) => {
    setError(null);
    setBusy(idea.id);
    try {
      const orderId = await acceptIdea(idea.id);
      await load();
      router.push(`/orders/${orderId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (idea: TaskIdea) => {
    setError(null);
    try {
      await dismissIdea(idea.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const proposed = ideas.filter((i) => i.status === 'proposed');
  if (batch === 'running' && !proposed.length) {
    return (
      <Card>
        <Text style={styles.title}>{t('ideas.title')}</Text>
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>{t('ideas.thinking')}</Text>
        </View>
      </Card>
    );
  }
  if (batch !== 'done' || !ideas.length) return null;

  const what = (idea: TaskIdea) => {
    const offer = offers.find((o) => o.service === idea.service_id && o.platform === idea.platform_id);
    const label = offer?.label ? localized(offer.label, language) : '';
    const fallback = names[idea.service_id] ? localized(names[idea.service_id].name, language) : '';
    const service = label || fallback;
    const price = offer?.price ?? names[idea.service_id]?.price;
    return [idea.platform_id ? platforms[idea.platform_id] : null, service, price != null ? formatAmd(price, language) : null]
      .filter(Boolean)
      .join(' · ');
  };

  return (
    <Card>
      <Text style={styles.title}>{t('ideas.title')}</Text>
      {!proposed.length && <Text style={styles.muted}>{t('ideas.allDecided')}</Text>}
      {proposed.map((idea) => {
        const agent = agentById(idea.agent);
        return (
          <View key={idea.id} style={styles.idea}>
            <View style={styles.row}>
              {agent && <AgentAvatar agent={agent} size={32} />}
              <Text style={styles.from}>
                {agent ? t('ideas.from', { name: t(`agents.names.${agent.id}`) }) : ''}
              </Text>
            </View>
            <Text style={styles.ideaTitle}>{idea.title}</Text>
            <Text style={styles.text}>{idea.description}</Text>
            <Text style={styles.muted}>{what(idea)}</Text>
            <View style={styles.actions}>
              <View style={styles.action}>
                <Button title={t('ideas.accept')} onPress={() => accept(idea)} loading={busy === idea.id} />
              </View>
              <View style={styles.action}>
                <Button title={t('ideas.later')} variant="ghost" onPress={() => dismiss(idea)} />
              </View>
            </View>
          </View>
        );
      })}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  muted: { fontSize: 14, lineHeight: 20, color: colors.muted },
  idea: {
    gap: 6,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  from: { fontSize: 14, fontWeight: '600', color: colors.text },
  ideaTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  text: { fontSize: 15, lineHeight: 21, color: colors.text },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
});
