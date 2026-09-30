import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { OrderTasks } from '@/components/OrderTasks';
import { Screen } from '@/components/Screen';
import { StatusBadge } from '@/components/StatusBadge';
import { colors } from '@/components/theme';
import { Button, Card, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmd, formatDate } from '@/lib/format';
import { confirmTestPayment, startPayment, type PaymentProvider } from '@/lib/payments';
import { platformName, serviceLabel } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import type { Order, OrderItem, Service } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { isTeamRole } from '@/lib/roles';

type ItemWithService = OrderItem & { services: Pick<Service, 'name'> | null };

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useI18n();
  const { profile } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<ItemWithService[]>([]);
  const [taskCount, setTaskCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<PaymentProvider | null>(null);
  const [testPaymentId, setTestPaymentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [orderRes, itemsRes, tasksRes] = await Promise.all([
      supabase.from('orders').select('*').eq('id', id).single<Order>(),
      supabase.from('order_items').select('*, services(name)').eq('order_id', id),
      supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('order_id', id),
    ]);
    setError(orderRes.error?.message ?? itemsRes.error?.message ?? null);
    setOrder(orderRes.data ?? null);
    setItems((itemsRes.data as ItemWithService[] | null) ?? []);
    setTaskCount(tasksRes.count ?? 0);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Пока заказ ждёт оплату, проверяем статус: банк подтверждает оплату на сервере.
  const pending = order?.status === 'pending_payment';
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [pending, load]);

  const pay = async (provider: PaymentProvider) => {
    setError(null);
    setPaying(provider);
    try {
      const result = await startPayment(id, provider, language);
      if (result) setTestPaymentId(result.testPaymentId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPaying(null);
    }
  };

  const finishTestPayment = async (success: boolean) => {
    if (!testPaymentId) return;
    setError(null);
    try {
      await confirmTestPayment(testPaymentId, success);
      setTestPaymentId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const repeat = async () => {
    setError(null);
    const { data, error } = await supabase.rpc('repeat_order', { p_order_id: id });
    if (error) setError(error.message);
    else router.push(`/orders/${data as string}`);
  };

  if (!order) {
    return (
      <View style={styles.center}>
        {error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const isOwner = profile?.id === order.client_id;
  const canChat = isOwner || isTeamRole(profile?.role);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>
          {t('order.orderFrom', { date: formatDate(order.created_at, language) })}
        </Text>
        <StatusBadge status={order.status} />
      </View>

      <Card>
        {items.map((item) => (
          <View key={item.id} style={styles.row}>
            <Text style={styles.text}>
              {platformName(item.platform_id) ? `${platformName(item.platform_id)} · ` : ''}
              {serviceLabel(item.service_id, item.services?.name, item.platform_id, language)} ×{' '}
              {item.quantity}
            </Text>
            <Text style={styles.text}>{formatAmd(item.line_total_amd, language)}</Text>
          </View>
        ))}
        {order.ad_budget_amd > 0 && (
          <View style={styles.row}>
            <Text style={styles.text}>{t('order.adBudget')}</Text>
            <Text style={styles.text}>{formatAmd(order.ad_budget_amd, language)}</Text>
          </View>
        )}
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.total}>{t('order.total')}</Text>
          <Text style={styles.total}>
            {formatAmd(order.total_amd, language)}
            {order.billing === 'monthly' ? ` ${t('order.perMonth')}` : ''}
          </Text>
        </View>
      </Card>

      <Card>
        <Text style={styles.muted}>
          {t('order.billing')}:{' '}
          {order.billing === 'monthly' ? t('order.monthly') : t('order.oneTime')}
        </Text>
        <Text style={styles.muted}>
          {t('order.publishing')}:{' '}
          {t(
            {
              team: 'order.publishTeam',
              auto: 'order.publishAuto',
              client: 'order.publishClient',
            }[order.publishing],
          )}
        </Text>
        {order.notes ? <Text style={styles.muted}>{order.notes}</Text> : null}
      </Card>

      <ErrorText>{error}</ErrorText>

      {!pending && (
        <OrderTasks orderId={order.id} isClient={isOwner} publishing={order.publishing} />
      )}

      {isOwner && !pending && (
        <Button title={t('order.repeat')} variant="ghost" onPress={repeat} />
      )}

      {canChat && (
        <Button
          title={t('chat.open')}
          variant="ghost"
          onPress={() => router.push(`/orders/${order.id}/chat`)}
        />
      )}

      {pending && isOwner && !testPaymentId && (
        <>
          <Text style={styles.section}>{t('order.payWith')}</Text>
          <Button title={t('order.payArca')} onPress={() => pay('arca')} loading={paying === 'arca'} />
          <Button
            title={t('order.payIdram')}
            onPress={() => pay('idram')}
            loading={paying === 'idram'}
          />
          <Button title={t('order.refresh')} variant="ghost" onPress={load} />
        </>
      )}

      {testPaymentId && (
        <Card>
          <Text style={styles.cardTitle}>{t('order.testPaymentTitle')}</Text>
          <Text style={styles.muted}>{t('order.testPaymentText')}</Text>
          <Button title={t('order.testPay')} onPress={() => finishTestPayment(true)} />
          <Button
            title={t('order.testCancel')}
            variant="ghost"
            onPress={() => finishTestPayment(false)}
          />
        </Card>
      )}

      {order.status !== 'pending_payment' && order.status !== 'cancelled' && (
        <Card>
          <Text style={styles.cardTitle}>{t('order.paidThanks')}</Text>
          <Text style={styles.muted}>{t('order.tasksCreated', { count: taskCount })}</Text>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 22, fontWeight: '700', color: colors.text },
  section: { fontSize: 18, fontWeight: '600', color: colors.text },
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  totalRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 8,
    marginTop: 4,
  },
  text: { fontSize: 15, color: colors.text, flexShrink: 1 },
  total: { fontSize: 17, fontWeight: '700', color: colors.text },
  muted: { fontSize: 15, color: colors.muted },
});
