import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { formatDate } from '@/lib/format';
import { useMoney } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import type { Order } from '@/lib/types';

import { EmptyState } from './EmptyState';
import { StatusBadge } from './StatusBadge';
import { colors } from './theme';
import { Card, ErrorText } from './ui';

// RLS сама ограничивает выборку: клиент видит свои заказы, команда — все.
export function OrdersList({
  title,
  empty,
}: {
  title: string;
  // Подсказка с кнопкой вместо «Заказов пока нет».
  empty?: { text: string; action: string; onAction: () => void };
}) {
  const { t, language } = useI18n();
  const { money } = useMoney();
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)
        .then(({ data, error }) => {
          setError(error?.message ?? null);
          setOrders((data as Order[] | null) ?? []);
        });
    }, []),
  );

  return (
    <Card>
      <Text style={styles.title}>{title}</Text>
      <ErrorText>{error}</ErrorText>
      {orders.length === 0 && !error &&
        (empty ? (
          <EmptyState icon="📦" text={empty.text} action={empty.action} onAction={empty.onAction} />
        ) : (
          <Text style={styles.muted}>{t('order.noOrders')}</Text>
        ))}
      {orders.map((order) => (
        <Link key={order.id} href={`/orders/${order.id}`} asChild>
          <Pressable style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.name}>
                {t('order.orderFrom', { date: formatDate(order.created_at, language) })}
              </Text>
              <Text style={styles.muted}>
                {money(order.total_amd)}
                {order.billing === 'monthly' ? ` ${t('order.perMonth')}` : ''}
              </Text>
            </View>
            <StatusBadge status={order.status} />
          </Pressable>
        </Link>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '600', color: colors.text },
  muted: { fontSize: 15, color: colors.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '500', color: colors.text },
});
