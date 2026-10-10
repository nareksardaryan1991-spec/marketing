import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Screen } from '@/components/Screen';
import { colors, fonts } from '@/components/theme';
import { Button, Card } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useAuth } from '@/providers/AuthProvider';

// Сотрудник зарегистрировался и ждёт, пока владелец назначит ему роль.
export default function PendingScreen() {
  const { t } = useI18n();
  const { profile, refresh, signOut } = useAuth();
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    await refresh();
    setChecking(false);
  };

  return (
    <Screen>
      <Text style={styles.title}>{t('pending.title', { name: profile?.full_name ?? '' })}</Text>
      <Card>
        <Text style={styles.text}>{t('pending.text')}</Text>
        <Button title={t('pending.check')} onPress={check} loading={checking} />
      </Card>
      <LanguageSwitcher />
      <Button title={t('common.signOut')} variant="ghost" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontFamily: fonts.display, color: colors.text, marginTop: 16 },
  text: { fontSize: 16, color: colors.text },
});
