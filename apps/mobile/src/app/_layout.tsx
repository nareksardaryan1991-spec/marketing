import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors, fonts, theme, themeName } from '@/components/theme';
import { THEME_FONTS } from '@/components/themeFonts';
import { Button } from '@/components/ui';
import { LanguageProvider, useI18n } from '@/i18n';
import '@/lib/webApp';
import { AuthProvider, isNetworkError, useAuth } from '@/providers/AuthProvider';

// Тема навигации: фон под экранами и шапки — в цветах оформления, иначе при переходах мелькает белый.
const baseNavTheme = theme.isDark ? DarkTheme : DefaultTheme;
const navTheme: Theme = {
  ...baseNavTheme,
  colors: {
    ...baseNavTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.border,
    notification: colors.danger,
  },
  fonts: {
    regular: { fontFamily: fonts.regular, fontWeight: '400' },
    medium: { fontFamily: fonts.medium, fontWeight: '500' },
    bold: { fontFamily: fonts.semibold, fontWeight: '600' },
    heavy: { fontFamily: fonts.bold, fontWeight: '700' },
  },
};

export default function RootLayout() {
  // Только шрифты выбранного оформления. Пока они грузятся, текст показывается системным шрифтом — экран не ждёт.
  useFonts(THEME_FONTS[themeName].all);
  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <LanguageProvider>
          <AuthProvider>
            <RootNavigator />
            <StatusBar style={theme.isDark ? 'light' : 'dark'} />
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
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

  // Знакомство проходят клиенты, у которых ещё нет бизнеса или знакомство не закончено
  // (ответы сохраняются в профиль бизнеса после каждого вопроса).
  const needsOnboarding = signedIn && profile?.role === 'client' && !business?.onboarded_at;
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
