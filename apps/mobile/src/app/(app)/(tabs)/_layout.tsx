import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';

import type { IconName } from '@/components/NavList';
import { colors } from '@/components/theme';
import { useI18n } from '@/i18n';
import { isEmployeeRole } from '@/lib/roles';
import { useUnreadChats, useWaitingApprovals } from '@/lib/useBadges';
import { useAuth } from '@/providers/AuthProvider';

// Нижнее меню: у каждой роли — свои 5 вкладок, остальное — в «Профиле».
// Клиент: Главная, Заказы, Согласование, Чаты, Профиль.
// Сотрудник и менеджер: Главная, Доска, Чаты, AI-агенты, Профиль.
export default function TabsLayout() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const client = profile?.role === 'client';
  const staff = isEmployeeRole(profile?.role);
  const unread = useUnreadChats(!!profile);
  const waiting = useWaitingApprovals(client);

  const icon = (name: IconName, active: IconName) =>
    function Icon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
      return <Ionicons name={focused ? active : name} size={size} color={color as string} />;
    };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, minHeight: 60 },
        // Пять вкладок на телефоне шириной 360 px: подписи по-армянски длиннее — шрифт мельче, без боковых полей.
        tabBarLabelStyle: { fontSize: 11, marginBottom: 2 },
        tabBarItemStyle: { paddingHorizontal: 0, paddingVertical: 4 },
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: t('tabs.home'), headerShown: false, tabBarIcon: icon('home-outline', 'home') }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: client ? t('order.myOrders') : t('tabs.ordersAll'),
          tabBarLabel: t('tabs.orders'),
          href: client ? undefined : null,
          tabBarIcon: icon('cube-outline', 'cube'),
        }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: t('approvals.title'),
          tabBarLabel: t('tabs.approvals'),
          href: client ? undefined : null,
          tabBarBadge: waiting || undefined,
          tabBarIcon: icon('checkmark-done-circle-outline', 'checkmark-done-circle'),
        }}
      />
      <Tabs.Screen
        name="board"
        options={{
          title: t('board.title'),
          tabBarLabel: t('tabs.board'),
          href: staff ? undefined : null,
          tabBarIcon: icon('albums-outline', 'albums'),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: t('chats.title'),
          tabBarBadge: unread || undefined,
          tabBarIcon: icon('chatbubbles-outline', 'chatbubbles'),
        }}
      />
      <Tabs.Screen
        name="agents"
        options={{
          title: t('agents.title'),
          tabBarLabel: t('tabs.agents'),
          href: staff ? undefined : null,
          tabBarIcon: icon('sparkles-outline', 'sparkles'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: icon('person-circle-outline', 'person-circle'),
        }}
      />
    </Tabs>
  );
}
