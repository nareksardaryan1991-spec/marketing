import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Screen } from '@/components/Screen';
import { StatusBadge } from '@/components/StatusBadge';
import { TasksList } from '@/components/TasksList';
import { colors } from '@/components/theme';
import { Card, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmd } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { OrderStatus, UserRole } from '@/lib/types';

type Dashboard = {
  is_admin: boolean;
  revenue_month: number | null;
  revenue_prev_month: number | null;
  paid_orders_month: number;
  active_clients: number;
  orders: Partial<Record<OrderStatus, number>>;
  tasks: Record<'unassigned' | 'in_work' | 'review' | 'client' | 'publish' | 'overdue', number>;
  workload: {
    id: string;
    name: string;
    role: UserRole;
    avatar_path: string | null;
    accent_color: string | null;
    open: number;
    overdue: number;
  }[];
};

const ORDER_STATUSES: OrderStatus[] = ['pending_payment', 'paid', 'in_progress', 'completed', 'cancelled'];

// Панель владельца и менеджеров: деньги (только владельцу), заказы, задачи, нагрузка команды.
export default function DashboardScreen() {
  const { t, language } = useI18n();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      supabase.rpc('owner_dashboard').then(({ data, error }) => {
        setError(error?.message ?? null);
        if (data) setData(data as Dashboard);
      });
    }, []),
  );

  if (!data) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const revenue = Number(data.revenue_month ?? 0);
  const previous = Number(data.revenue_prev_month ?? 0);
  const change = previous > 0 ? Math.round(((revenue - previous) / previous) * 100) : null;
  const maxOpen = Math.max(1, ...data.workload.map((w) => Number(w.open)));

  const tile = (label: string, value: string | number, tone?: 'danger' | 'warn', onPress?: () => void) => (
    <Pressable
      key={label}
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.tile, tone === 'danger' && Number(value) > 0 && styles.tileDanger]}>
      <Text style={[styles.tileValue, tone === 'danger' && Number(value) > 0 && styles.danger, tone === 'warn' && Number(value) > 0 && styles.warn]}>
        {value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );

  return (
    <Screen>
      <ErrorText>{error}</ErrorText>

      {data.is_admin && (
        <Card>
          <Text style={styles.label}>{t('dashboard.revenueMonth')}</Text>
          <Text style={styles.revenue}>{formatAmd(revenue, language)}</Text>
          <Text style={styles.muted}>
            {t('dashboard.prevMonth')}: {formatAmd(previous, language)}
            {change !== null && (
              <Text style={change >= 0 ? styles.up : styles.danger}>
                {'  '}
                {change >= 0 ? '▲' : '▼'} {Math.abs(change)}%
              </Text>
            )}
          </Text>
        </Card>
      )}

      <View style={styles.tiles}>
        {tile(t('dashboard.paidOrders'), data.paid_orders_month)}
        {tile(t('dashboard.activeClients'), data.active_clients)}
        {tile(t('dashboard.overdue'), data.tasks.overdue, 'danger', () => router.push('/board'))}
        {tile(t('dashboard.unassigned'), data.tasks.unassigned, 'warn', () => router.push('/board'))}
        {tile(t('dashboard.inWork'), data.tasks.in_work, undefined, () => router.push('/board'))}
        {tile(t('dashboard.review'), data.tasks.review, 'warn', () => router.push('/board'))}
        {tile(t('dashboard.atClient'), data.tasks.client)}
        {tile(t('dashboard.toPublish'), data.tasks.publish)}
      </View>

      <Card>
        <Text style={styles.cardTitle}>{t('dashboard.workload')}</Text>
        {data.workload.length === 0 && <Text style={styles.muted}>{t('dashboard.noTeam')}</Text>}
        {data.workload.map((w) => (
          <View key={w.id} style={styles.person}>
            <Avatar name={w.name} path={w.avatar_path} color={w.accent_color} size={36} />
            <View style={styles.personBody}>
              <View style={styles.personLine}>
                <Text style={styles.personName} numberOfLines={1}>
                  {w.name}
                </Text>
                <Text style={styles.muted}>{t(`roles.${w.role}`)}</Text>
              </View>
              <View style={styles.barTrack}>
                <View style={[styles.bar, { width: `${(Number(w.open) / maxOpen) * 100}%` }]} />
              </View>
              <Text style={styles.personStats}>
                {t('dashboard.openTasks', { count: Number(w.open) })}
                {Number(w.overdue) > 0 && (
                  <Text style={styles.danger}> · {t('dashboard.overdueTasks', { count: Number(w.overdue) })}</Text>
                )}
              </Text>
            </View>
          </View>
        ))}
      </Card>

      <TasksList title={t('dashboard.overdueList')} overdueOnly emptyText={t('dashboard.noOverdue')} />

      <Card>
        <Text style={styles.cardTitle}>{t('dashboard.orders')}</Text>
        {ORDER_STATUSES.filter((s) => data.orders[s]).map((s) => (
          <View key={s} style={styles.orderLine}>
            <StatusBadge status={s} />
            <Text style={styles.orderCount}>{data.orders[s]}</Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, color: colors.muted, textTransform: 'uppercase' },
  revenue: { fontSize: 32, fontWeight: '800', color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  up: { color: '#16A34A', fontWeight: '700' },
  danger: { color: '#DC2626', fontWeight: '700' },
  warn: { color: '#D97706' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 120,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
  },
  tileDanger: { borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },
  tileValue: { fontSize: 26, fontWeight: '800', color: colors.text },
  tileLabel: { fontSize: 13, color: colors.muted },
  cardTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  personBody: { flex: 1, gap: 4 },
  personLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  personName: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: '#ECEEF4', overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  personStats: { fontSize: 13, color: colors.muted },
  orderLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  orderCount: { fontSize: 16, fontWeight: '700', color: colors.text },
});
