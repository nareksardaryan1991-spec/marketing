import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { colors } from '@/components/theme';
import { useI18n } from '@/i18n';
import { registerPush } from '@/lib/push';
import { useNotificationTaps } from '@/lib/useNotificationTaps';
import { useAuth } from '@/providers/AuthProvider';

export default function AppLayout() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const userId = profile?.id;

  // Токен обновляется при каждом входе; разрешение спрашиваем один раз.
  useEffect(() => {
    if (userId) registerPush(userId, true);
  }, [userId]);
  useNotificationTaps(profile?.role === 'client');

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="new-order" options={{ title: t('order.newOrder') }} />
      <Stack.Screen name="orders/[id]/index" options={{ title: t('order.order') }} />
      <Stack.Screen name="orders/[id]/chat" options={{ title: t('chat.title') }} />
      <Stack.Screen name="notifications" options={{ title: t('notify.title') }} />
      <Stack.Screen name="tasks/[id]" options={{ title: t('task.task') }} />
      <Stack.Screen name="team" options={{ title: t('team.title') }} />
      <Stack.Screen name="calendar" options={{ title: t('calendar.title') }} />
      <Stack.Screen name="social" options={{ title: t('social.title') }} />
      <Stack.Screen name="business" options={{ title: t('business.title') }} />
      <Stack.Screen name="services" options={{ title: t('services.title') }} />
      <Stack.Screen name="reports" options={{ title: t('reports.title') }} />
      <Stack.Screen name="team-chat/index" options={{ title: t('teamChat.title') }} />
      <Stack.Screen name="team-chat/[id]" options={{ title: t('teamChat.title') }} />
    </Stack>
  );
}
