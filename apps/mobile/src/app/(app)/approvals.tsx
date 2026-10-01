import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ProfileGrid, type GridItem } from '@/components/approval/ProfileGrid';
import { ReviewItem, type ReviewTask } from '@/components/approval/ReviewItem';
import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { Button, Card, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { loadAutoApproveDays } from '@/lib/approvals';
import { photoUrl } from '@/lib/avatars';
import { signedUrls } from '@/lib/files';
import { taskTitle } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import type { Deliverable, Localized, Task } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

type WaitingRow = ReviewTask & { services: { name: Localized } | null };
type GridRow = Pick<Task, 'id' | 'status' | 'publish_at' | 'published_at'> & {
  deliverables: Pick<Deliverable, 'files' | 'version'>[];
};

const latestFiles = (d: Pick<Deliverable, 'files' | 'version'>[]) =>
  [...d].sort((a, b) => b.version - a.version)[0]?.files ?? [];

// «На согласовании»: все материалы клиента в виде постов, «Одобрить всё» и сетка профиля.
export default function ApprovalsScreen() {
  const { t, language } = useI18n();
  const { profile, business } = useAuth();
  const [waiting, setWaiting] = useState<WaitingRow[] | null>(null);
  const [grid, setGrid] = useState<GridRow[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [autoDays, setAutoDays] = useState(0);
  const [view, setView] = useState<'feed' | 'grid'>('feed');
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [waitingRes, gridRes, days] = await Promise.all([
      supabase
        .from('tasks')
        .select('*, services(name), deliverables(*)')
        .eq('status', 'client_review')
        .order('client_review_since'),
      business
        ? supabase
            .from('tasks')
            .select('id, status, publish_at, published_at, deliverables(files, version)')
            .eq('business_id', business.id)
            .in('service_id', ['post', 'reel'])
            .or('platform_id.is.null,platform_id.eq.instagram')
            .in('status', ['client_review', 'approved', 'publishing', 'published'])
        : Promise.resolve({ data: [], error: null }),
      loadAutoApproveDays(),
    ]);
    setError(waitingRes.error?.message ?? gridRes.error?.message ?? null);
    const rows = (waitingRes.data as WaitingRow[] | null) ?? [];
    const gridRows = sortGrid((gridRes.data as GridRow[] | null) ?? []);
    setWaiting(rows);
    setGrid(gridRows);
    setAutoDays(days);
    setConfirmAll(false);
    const paths = [
      ...rows.flatMap((r) => latestFiles(r.deliverables)),
      ...gridRows.map((r) => latestFiles(r.deliverables)[0]).filter(Boolean),
    ];
    signedUrls([...new Set(paths)])
      .then(setUrls)
      .catch(() => setUrls({}));
  }, [business]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const approveAll = async () => {
    if (!waiting) return;
    if (!confirmAll) return setConfirmAll(true);
    setBusy(true);
    const { error } = await supabase.rpc('client_approve_many', {
      p_task_ids: waiting.map((task) => task.id),
    });
    setBusy(false);
    if (error) setError(error.message);
    else load();
  };

  if (!profile || waiting === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const name = business?.name ?? profile.full_name;
  const avatar = photoUrl(profile.avatar_path);
  const gridItems: GridItem[] = grid.map((row) => {
    const path = latestFiles(row.deliverables)[0] ?? null;
    return {
      id: row.id,
      path,
      url: path ? urls[path] : undefined,
      state:
        row.status === 'client_review' ? 'waiting' : row.status === 'published' ? 'published' : 'approved',
    };
  });

  return (
    <Screen>
      <View style={styles.tabs}>
        {(['feed', 'grid'] as const).map((v) => (
          <Pressable
            key={v}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === v }}
            onPress={() => setView(v)}
            style={[styles.tab, view === v && styles.tabOn]}>
            <Text style={[styles.tabText, view === v && styles.tabTextOn]}>
              {v === 'feed' ? t('approvals.feed') : t('approvals.grid')}
            </Text>
          </Pressable>
        ))}
      </View>
      <ErrorText>{error}</ErrorText>

      {view === 'grid' ? (
        <Card>
          <Text style={styles.muted}>{t('approvals.gridHint')}</Text>
          {gridItems.length > 0 ? (
            <ProfileGrid items={gridItems} />
          ) : (
            <Text style={styles.muted}>{t('approvals.gridEmpty')}</Text>
          )}
        </Card>
      ) : waiting.length === 0 ? (
        <Card>
          <Text style={styles.empty}>{t('approvals.empty')}</Text>
        </Card>
      ) : (
        <>
          {waiting.length > 1 && (
            <Card>
              <Text style={styles.muted}>{t('approvals.allHint', { count: waiting.length })}</Text>
              <Button
                title={
                  confirmAll
                    ? t('approvals.approveAllConfirm', { count: waiting.length })
                    : t('approvals.approveAll', { count: waiting.length })
                }
                onPress={approveAll}
                loading={busy}
              />
              {confirmAll && (
                <Button title={t('common.back')} variant="ghost" onPress={() => setConfirmAll(false)} />
              )}
            </Card>
          )}
          {waiting.map((task) => (
            <ReviewItem
              key={task.id}
              task={task}
              title={taskTitle(task, task.services?.name, language)}
              name={name}
              avatarUrl={avatar}
              urls={urls}
              autoDays={autoDays}
              onDone={load}
            />
          ))}
        </>
      )}
    </Screen>
  );
}

// Как в профиле: сверху то, что выйдет позже всего, внизу — давно опубликованное.
function sortGrid(rows: GridRow[]): GridRow[] {
  const upcoming = rows
    .filter((r) => r.status !== 'published')
    .sort((a, b) => (b.publish_at ?? '9999').localeCompare(a.publish_at ?? '9999'));
  const published = rows
    .filter((r) => r.status === 'published')
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
  return [...upcoming, ...published];
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabs: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 12,
    backgroundColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabOn: { backgroundColor: colors.surface },
  tabText: { fontSize: 15, fontWeight: '600', color: colors.muted },
  tabTextOn: { color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  empty: { fontSize: 16, color: colors.muted, textAlign: 'center', paddingVertical: 12 },
});
