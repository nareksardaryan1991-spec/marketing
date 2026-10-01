import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { AgentChat } from '@/components/agents/AgentChat';
import { AgentLaunch } from '@/components/agents/AgentLaunch';
import { AgentRuns } from '@/components/agents/AgentRuns';
import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { Card, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { AGENTS, isAgentId } from '@/lib/agents';
import { formatDate } from '@/lib/format';
import { isManagerRole } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

type OrderRow = { id: string; created_at: string; businesses: { name: string } | null };

// Экран агента: для ролей — чат («напиши, что сделать»), для AI-менеджера — план по заказу.
export default function AgentScreen() {
  const { agent: param } = useLocalSearchParams<{ agent: string }>();
  const { t } = useI18n();
  const { profile } = useAuth();
  const meta = AGENTS.find((a) => a.id === param);

  if (!meta || !isAgentId(param)) return null;
  const title = `${meta.icon} ${t(`agents.names.${meta.id}`)}`;

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <Text style={styles.does}>{t(`agents.does.${meta.id}`)}</Text>
      {meta.id === 'manager' ? (
        isManagerRole(profile?.role) ? <ManagerAgent /> : null
      ) : (
        <AgentChat agent={meta.id} />
      )}
    </Screen>
  );
}

function ManagerAgent() {
  const { t, language } = useI18n();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('id, created_at, businesses(name)')
      .in('status', ['paid', 'in_progress'])
      .order('created_at', { ascending: false });
    setError(error?.message ?? null);
    setOrders((data as OrderRow[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const manager = AGENTS.find((a) => a.id === 'manager')!;

  return (
    <>
      <Card>
        <Text style={styles.title}>{t('agents.pickOrder')}</Text>
        <ErrorText>{error}</ErrorText>
        {orders.length === 0 && !error && <Text style={styles.muted}>{t('agents.noOrders')}</Text>}
        {orders.map((order) => (
          <Pressable
            key={order.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected === order.id }}
            onPress={() => setSelected(order.id)}
            style={[styles.row, selected === order.id && styles.rowActive]}>
            <Text style={styles.name}>{order.businesses?.name ?? '—'}</Text>
            <Text style={styles.muted}>{t('order.orderFrom', { date: formatDate(order.created_at, language) })}</Text>
          </Pressable>
        ))}
      </Card>
      <AgentLaunch
        agents={[manager]}
        orderId={selected ?? undefined}
        disabled={selected ? undefined : t('agents.pickOrder')}
        onStarted={() => {
          setSelected(null);
          setRefreshKey((k) => k + 1);
        }}
      />
      <AgentRuns agent="manager" refreshKey={refreshKey} />
    </>
  );
}

const styles = StyleSheet.create({
  does: { fontSize: 15, color: colors.muted },
  title: { fontSize: 18, fontWeight: '600', color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  name: { fontSize: 16, fontWeight: '500', color: colors.text },
  row: { gap: 2, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  rowActive: { borderColor: colors.primary, backgroundColor: colors.background },
});
