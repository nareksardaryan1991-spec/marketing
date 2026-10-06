import { router } from 'expo-router';

import { ClientsList } from '@/components/ClientsList';
import { OrdersList } from '@/components/OrdersList';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useAuth } from '@/providers/AuthProvider';

// Заказы: у клиента — вкладка «Заказы»; у команды — «Все заказы и клиенты» с главной.
export default function OrdersScreen() {
  const { t } = useI18n();
  const { profile } = useAuth();

  if (profile?.role === 'client') {
    return (
      <Screen>
        <Button title={t('order.newOrder')} onPress={() => router.push('/new-order')} />
        <OrdersList
          title={t('order.myOrders')}
          empty={{
            text: t('home.ordersEmpty'),
            action: t('order.newOrder'),
            onAction: () => router.push('/new-order'),
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <OrdersList title={t('order.allOrders')} />
      <ClientsList />
    </Screen>
  );
}
