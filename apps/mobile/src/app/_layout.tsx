import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/components/theme';
import { Button } from '@/components/ui';
import { LanguageProvider, useI18n } from '@/i18n';
import '@/lib/webApp';
import { AuthProvider, isNetworkError, useAuth } from '@/providers/AuthProvider';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <AuthProvider>
          <RootNavigator />
          <StatusBar style="dark" />
        </AuthProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { session, profile, business, loading, loadError, refresh, signOut } = useAuth();
  const { t } = useI18n();

  const signedIn = !!session;
  const waitingForProfile = signedIn && !profile;

  if (loading || waitingForProfile) {
    return (
      <View style={styles.splash}>
        {loadError ? (
          <>
            <Text style={styles.error}>
              {isNetworkError(loadError) ? t('common.networkError') : `${t('common.error')}: ${loadError}`}
            </Text>
            <Button title={t('common.retry')} onPress={refresh} />
            <Button title={t('common.signOut')} variant="ghost" onPress={signOut} />
          </>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
    );
  }

  // Анкету проходят только клиенты, у которых ещё нет бизнеса.
  const needsOnboarding = signedIn && profile?.role === 'client' && !business;
  // Сотрудник без роли ждёт, пока владелец её назначит.
  const pending = signedIn && profile?.role === 'pending';

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={needsOnboarding}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={pending}>
        <Stack.Screen name="pending" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !needsOnboarding && !pending}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: colors.background,
  },
  error: { color: colors.danger, textAlign: 'center' },
});
