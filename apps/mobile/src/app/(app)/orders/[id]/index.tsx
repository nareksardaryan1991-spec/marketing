import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { NavList, NavRow } from '@/components/NavList';
import { OrderTasks } from '@/components/OrderTasks';
import { Screen } from '@/components/Screen';
import { StatusBadge } from '@/components/StatusBadge';
import { colors, fonts } from '@/components/theme';
import { Button, Card, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDate, localized } from '@/lib/format';
import { useMoney } from '@/lib/money';
import { confirmTestPayment, startPayment, type PaymentProvider } from '@/lib/payments';
import { platformName, serviceLabel } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import type { Localized, Order, OrderItem, Service } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { isTeamRole } from '@/lib/roles';

type OrderRow = Order & { packages?: { name: Localized } | null };

type ItemWithService = OrderItem & { services: Pick<Service, 'name'> | null };

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useI18n();
  const { money, moneyToPay, currency } = useMoney();
  const { profile } = useAuth();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [items, setItems] = useState<ItemWithService[]>([]);
  const [taskCount, setTaskCount] = useState(0);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<PaymentProvider | null>(null);
  const [testPaymentId, setTestPaymentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [orderRes, itemsRes, tasksRes, paidRes, testRes] = await Promise.all([
      supabase.from('orders').select('*, packages(name)').eq('id', id).single<OrderRow>(),
      supabase.from('order_items').select('*, services(name)').eq('order_id', id),
      supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('order_id', id),
      supabase
        .from('payments')
        .select('id')
        .eq('order_id', id)
        .eq('status', 'succeeded')
        .order('receipt_no')
        .limit(1),
      // Тестовая оплата, которую ещё не подтвердил владелец (клиент видит свою, владелец — все).
      supabase
        .from('payments')
        .select('id')
        .eq('order_id', id)
        .eq('provider', 'test')
        .eq('status', 'created')
        .order('created_at', { ascending: false })
        .limit(1),
    ]);
    setReceiptId(paidRes.data?.[0]?.id ?? null);
    setTestPaymentId(testRes.data?.[0]?.id ?? null);
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
      // В тестовом режиме платёж ждёт подтверждения владельца — load() его подхватит.
      await startPayment(id, provider, language);
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
  // Тестовую оплату подтверждает только владелец агентства (так же проверяет сервер).
  const isAdmin = profile?.role === 'admin';
  const canChat = isOwner || isTeamRole(profile?.role);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>
          {t('order.orderFrom', { date: formatDate(order.created_at, language) })}
        </Text>
        <StatusBadge status={order.status} />
      </View>
      {order.packages && (
        <Text style={styles.muted}>
          📦 {t('packages.orderOf', { name: localized(order.packages.name, language) })}
        </Text>
      )}

      <Card>
        {items.map((item) => (
          <View key={item.id} style={styles.row}>
            <Text style={styles.text}>
              {platformName(item.platform_id) ? `${platformName(item.platform_id)} · ` : ''}
              {serviceLabel(item.service_id, item.services?.name, item.platform_id, language)} ×{' '}
              {item.quantity}
            </Text>
            <Text style={styles.text}>{money(item.line_total_amd)}</Text>
          </View>
        ))}
        {order.discount_amd > 0 && (
          <View style={styles.row}>
            <Text style={styles.text}>
              {t('promo.discount')} ({order.promo_code ?? '—'})
            </Text>
            <Text style={styles.text}>−{money(order.discount_amd)}</Text>
          </View>
        )}
        {order.ad_budget_amd > 0 && (
          <View style={styles.row}>
            <Text style={styles.text}>{t('order.adBudget')}</Text>
            <Text style={styles.text}>{money(order.ad_budget_amd)}</Text>
          </View>
        )}
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.total}>{t('order.total')}</Text>
          <Text style={styles.total}>
            {moneyToPay(order.total_amd)}
            {order.billing === 'monthly' ? ` ${t('order.perMonth')}` : ''}
          </Text>
        </View>
        {currency !== 'AMD' && <Text style={styles.muted}>{t('money.payInAmd')}</Text>}
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

      {(canChat || (isOwner && receiptId)) && (
        <NavList>
          {canChat && <NavRow icon="chatbubbles-outline" title={t('chat.open')} href={`/orders/${order.id}/chat`} />}
          {isOwner && receiptId && (
            <NavRow icon="receipt-outline" title={t('receipts.receiptButton')} href={`/receipts/${receiptId}`} />
          )}
        </NavList>
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

      {pending && testPaymentId && (
        <Card>
          <Text style={styles.cardTitle}>{t('order.testPaymentTitle')}</Text>
          {isAdmin ? (
            <>
              <Text style={styles.muted}>{t('order.testPaymentOwner')}</Text>
              <Button title={t('order.testPay')} onPress={() => finishTestPayment(true)} />
              <Button
                title={t('order.testCancel')}
                variant="ghost"
                onPress={() => finishTestPayment(false)}
              />
            </>
          ) : (
            <Text style={styles.muted}>{t('order.testPaymentWaiting')}</Text>
          )}
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
  title: { flex: 1, fontSize: 20, fontFamily: fonts.display, color: colors.text },
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
