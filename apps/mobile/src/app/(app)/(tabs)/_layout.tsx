import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { StyleSheet, View, type ColorValue } from 'react-native';

import type { IconName } from '@/components/NavList';
import { colors, fonts, outlinedSmall } from '@/components/theme';
import { useI18n } from '@/i18n';
import { canUseAgents, isEmployeeRole } from '@/lib/roles';
import { useUnreadChats, useUnreadTaskNotifications, useWaitingApprovals } from '@/lib/useBadges';
import { useAuth } from '@/providers/AuthProvider';

// Нижнее меню: у каждой роли свои вкладки, остальное — в «Профиле».
// Клиент: Главная, Заказы, Согласование, Чаты, Профиль.
// Штат и менеджер: Главная, Доска, Команда (задачи людям), Чаты, AI-агенты, Профиль.
// У роли «Сотрудник» агентов нет — пять вкладок.
export default function TabsLayout() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const client = profile?.role === 'client';
  const staff = isEmployeeRole(profile?.role);
  const agents = canUseAgents(profile?.role);
  const unread = useUnreadChats(!!profile);
  const waiting = useWaitingApprovals(client);
  const taskNews = useUnreadTaskNotifications(staff);

  // Активная вкладка — значок на салатовой «таблетке», как в макете B.
  const icon = (name: IconName, active: IconName) =>
    function Icon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
      if (!focused) return <Ionicons name={name} size={size} color={color as string} />;
      return (
        <View style={styles.activePill}>
          <Ionicons name={active} size={size - 2} color={colors.primaryText} />
        </View>
      );
    };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        // Меню «парит» над фоном: скруглённая плашка с отступами по краям.
        tabBarStyle: styles.tabBar,
        // До шести вкладок на телефоне шириной 360 px: подписи по-армянски длиннее — шрифт мельче, без боковых полей.
        tabBarLabelStyle: { fontSize: 10, marginBottom: 2, fontFamily: fonts.medium },
        tabBarItemStyle: { paddingHorizontal: 0, paddingVertical: 4 },
        tabBarBadgeStyle: { backgroundColor: colors.danger, color: colors.dangerText, fontFamily: fonts.bold },
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text, fontFamily: fonts.display, fontSize: 20 },
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
        name="team-tasks"
        options={{
          title: t('teamTasks.title'),
          tabBarLabel: t('tabs.teamTasks'),
          href: staff ? undefined : null,
          tabBarBadge: taskNews || undefined,
          tabBarIcon: icon('people-outline', 'people'),
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
          href: agents ? undefined : null,
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

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.tabBar,
    borderTopWidth: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 28,
    marginHorizontal: 10,
    marginBottom: 10,
    minHeight: 64,
    paddingTop: 4,
    ...outlinedSmall,
  },
  activePill: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 3,
  },
});
