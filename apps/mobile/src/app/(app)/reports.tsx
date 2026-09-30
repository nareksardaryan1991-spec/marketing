import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { compactNumber } from '@/components/report/chartTokens';
import { PostBars, type PostBar } from '@/components/report/PostBars';
import { StatTile } from '@/components/report/StatTile';
import { Screen } from '@/components/Screen';
import { taskStyles } from '@/components/task/styles';
import { colors } from '@/components/theme';
import { Button, Card, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDate } from '@/lib/format';
import { taskTitle } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import {
  SOCIAL_ACCOUNT_COLUMNS,
  type AccountSnapshot,
  type Localized,
  type PostMetrics,
  type SocialAccount,
  type TaskStatus,
} from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

const LOCALES = { ru: 'ru-RU', hy: 'hy-AM', en: 'en-US' } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

type MetricsRow = PostMetrics & {
  tasks: {
    number: number;
    service_id: string;
    platform_id: string | null;
    published_at: string | null;
    published_url: string | null;
    services: { name: Localized } | null;
  } | null;
};

type WorkRow = { status: TaskStatus; published_at: string | null; publish_at: string | null };

type Report = {
  businessName: string;
  account: SocialAccount | null;
  latest: AccountSnapshot | null;
  monthAgo: AccountSnapshot | null;
  posts: MetricsRow[];
  work: { published: number; scheduled: number; inWork: number };
};

function summarizeWork(rows: WorkRow[], since: Date) {
  return {
    published: rows.filter(
      (w) => w.status === 'published' && w.published_at && new Date(w.published_at) >= since,
    ).length,
    scheduled: rows.filter(
      (w) => (w.status === 'approved' || w.status === 'publishing') && w.publish_at,
    ).length,
    inWork: rows.filter((w) => !['published', 'approved', 'publishing'].includes(w.status)).length,
  };
}

// Отчёт за последние 30 дней: клиент видит свой бизнес, команда — любой (?business=…).
export default function ReportsScreen() {
  const params = useLocalSearchParams<{ business?: string }>();
  const { t, language } = useI18n();
  const { business: own, profile } = useAuth();
  const businessId = params.business ?? own?.id;
  const locale = LOCALES[language];
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!businessId) return;
    const since = new Date(Date.now() - 30 * DAY_MS);
    Promise.all([
      supabase.from('businesses').select('name').eq('id', businessId).single(),
      supabase
        .from('social_accounts')
        .select(SOCIAL_ACCOUNT_COLUMNS)
        .eq('business_id', businessId)
        .eq('platform', 'instagram')
        .maybeSingle<SocialAccount>(),
      supabase
        .from('account_snapshots')
        .select('*')
        .eq('business_id', businessId)
        .gte('taken_on', new Date(Date.now() - 35 * DAY_MS).toISOString().slice(0, 10))
        .order('taken_on'),
      supabase
        .from('post_metrics')
        .select('*, tasks(number, service_id, platform_id, published_at, published_url, services(name))')
        .eq('business_id', businessId),
      supabase
        .from('tasks')
        .select('status, published_at, publish_at')
        .eq('business_id', businessId),
    ]).then(([biz, account, snapshots, posts, work]) => {
      setError(
        biz.error?.message ?? snapshots.error?.message ?? posts.error?.message ?? work.error?.message ?? null,
      );
      const snaps = (snapshots.data as AccountSnapshot[] | null) ?? [];
      const recentPosts = ((posts.data as MetricsRow[] | null) ?? [])
        .filter((p) => p.tasks?.published_at && new Date(p.tasks.published_at) >= since)
        .sort((a, b) => b.tasks!.published_at!.localeCompare(a.tasks!.published_at!));
      setReport({
        businessName: biz.data?.name ?? '',
        account: account.data ?? null,
        latest: snaps.at(-1) ?? null,
        // Самый ранний снимок не новее 30 дней назад — база для сравнения подписчиков.
        monthAgo: snaps.find((s) => new Date(s.taken_on) <= since) ?? snaps[0] ?? null,
        posts: recentPosts,
        work: summarizeWork((work.data as WorkRow[] | null) ?? [], since),
      });
    });
  }, [businessId]);

  useFocusEffect(load);

  if (!report) {
    return (
      <View style={styles.center}>
        {error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const { account, latest, monthAgo } = report;
  const m = latest?.metrics_30d ?? {};
  const fmt = (v: number | undefined) => (v === undefined ? '—' : compactNumber(v, locale));

  let followersDelta: Parameters<typeof StatTile>[0]['delta'];
  if (latest?.followers_count != null && monthAgo?.followers_count != null && monthAgo !== latest) {
    const diff = latest.followers_count - monthAgo.followers_count;
    followersDelta = {
      text: `${diff > 0 ? '+' : ''}${new Intl.NumberFormat(locale).format(diff)} ${t('reports.vsMonthAgo')}`,
      direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
    };
  }

  const bars: PostBar[] = report.posts.map((p) => {
    const pm = p.metrics;
    const parts = [
      pm.likes !== undefined && `♥ ${pm.likes}`,
      pm.comments !== undefined && `💬 ${pm.comments}`,
      pm.saved !== undefined && `🔖 ${pm.saved}`,
      pm.shares !== undefined && `↗ ${pm.shares}`,
      pm.views !== undefined && `${t('reports.views')}: ${compactNumber(pm.views, locale)}`,
    ].filter(Boolean);
    return {
      id: p.task_id,
      title: p.tasks ? taskTitle(p.tasks, p.tasks.services?.name, language) : '',
      subtitle: p.tasks?.published_at ? formatDate(p.tasks.published_at, language) : '',
      reach: pm.reach ?? 0,
      details: parts.join('   '),
      url: p.permalink ?? p.tasks?.published_url ?? null,
    };
  });

  const isClient = profile?.role === 'client';

  return (
    <Screen>
      <View>
        <Text style={styles.title}>{report.businessName}</Text>
        <Text style={styles.muted}>{t('reports.period')}</Text>
      </View>

      {!account && (
        <Card>
          <Text style={taskStyles.cardTitle}>Instagram</Text>
          <Text style={styles.muted}>{t('reports.connectHint')}</Text>
          {isClient && (
            <Button title={t('social.connect')} onPress={() => router.push('/social')} />
          )}
        </Card>
      )}
      {account?.insights_error && (
        <Card>
          <Text style={{ color: colors.danger }}>{t('reports.insightsError')}</Text>
          <Text style={styles.muted}>{account.insights_error}</Text>
          {isClient && (
            <Button title={t('social.reconnect')} onPress={() => router.push('/social')} />
          )}
        </Card>
      )}
      {account && !latest && !account.insights_error && (
        <Text style={styles.muted}>{t('reports.firstDataSoon')}</Text>
      )}

      {latest && (
        <View style={styles.tiles}>
          <StatTile
            label={t('reports.followers')}
            value={fmt(latest.followers_count ?? undefined)}
            delta={followersDelta}
          />
          <StatTile label={t('reports.reach')} value={fmt(m.reach)} />
          <StatTile label={t('reports.views')} value={fmt(m.views)} />
          <StatTile label={t('reports.interactions')} value={fmt(m.total_interactions)} />
        </View>
      )}

      {bars.length > 0 && (
        <Card>
          <Text style={taskStyles.cardTitle}>{t('reports.postsReach')}</Text>
          <Text style={styles.muted}>{t('reports.postsReachHint')}</Text>
          <PostBars posts={bars} locale={locale} />
        </Card>
      )}

      <Card>
        <Text style={taskStyles.cardTitle}>{t('reports.work')}</Text>
        <Text style={taskStyles.text}>{t('reports.published', { count: report.work.published })}</Text>
        <Text style={taskStyles.text}>{t('reports.scheduled', { count: report.work.scheduled })}</Text>
        <Text style={taskStyles.text}>{t('reports.inWork', { count: report.work.inWork })}</Text>
      </Card>

      {account?.insights_updated_at && (
        <Text style={styles.muted}>
          {t('reports.updated', { date: formatDate(account.insights_updated_at, language) })}
        </Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
