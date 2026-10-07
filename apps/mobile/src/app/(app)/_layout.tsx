import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { colors } from '@/components/theme';
import { useI18n } from '@/i18n';
import { registerPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { useNotificationTaps } from '@/lib/useNotificationTaps';
import { useAuth } from '@/providers/AuthProvider';

export default function AppLayout() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const userId = profile?.id;

  // Токен обновляется при каждом входе; разрешение спрашиваем один раз.
  // В браузере — только по кнопке на экране уведомлений: Safari не показывает запрос без нажатия.
  useEffect(() => {
    if (userId) registerPush(userId, Platform.OS !== 'web');
  }, [userId]);
  useNotificationTaps(profile?.role === 'client');

  // «В сети» для чатов: раз в минуту, пока приложение открыто на экране.
  useEffect(() => {
    if (!userId) return;
    const touch = () => {
      if (AppState.currentState === 'active') supabase.rpc('touch_last_seen').then();
    };
    touch();
    const timer = setInterval(touch, 60_000);
    const subscription = AppState.addEventListener('change', touch);
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [userId]);

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}>
      {/* Нижнее меню; остальные экраны открываются поверх него. */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="new-order" options={{ title: t('order.newOrder') }} />
      <Stack.Screen name="orders/[id]/index" options={{ title: t('order.order') }} />
      <Stack.Screen name="orders/[id]/chat" options={{ title: t('chat.title') }} />
      <Stack.Screen name="notifications" options={{ title: t('notify.title') }} />
      <Stack.Screen name="tasks/[id]" options={{ title: t('task.task') }} />
      <Stack.Screen name="team-tasks/edit" options={{ title: t('teamTasks.title') }} />
      <Stack.Screen name="team" options={{ title: t('team.title') }} />
      <Stack.Screen name="calendar" options={{ title: t('calendar.title') }} />
      <Stack.Screen name="social" options={{ title: t('social.title') }} />
      <Stack.Screen name="business" options={{ title: t('business.title') }} />
      <Stack.Screen name="welcome" options={{ title: t('welcome.title') }} />
      <Stack.Screen name="services" options={{ title: t('services.title') }} />
      <Stack.Screen name="reports" options={{ title: t('reports.title') }} />
      <Stack.Screen name="receipts/index" options={{ title: t('receipts.title') }} />
      <Stack.Screen name="receipts/[id]" options={{ title: t('receipts.title') }} />
      <Stack.Screen name="dashboard" options={{ title: t('dashboard.title') }} />
      <Stack.Screen name="team-chat/index" options={{ title: t('chats.title') }} />
      <Stack.Screen name="team-chat/[id]" options={{ title: t('teamChat.title') }} />
      <Stack.Screen name="group/[id]" options={{ title: t('chats.groupInfo') }} />
      <Stack.Screen name="agents/[agent]" options={{ title: t('agents.title') }} />
    </Stack>
  );
}
