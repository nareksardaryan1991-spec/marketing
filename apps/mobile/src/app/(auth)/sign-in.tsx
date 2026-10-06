import { Link } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { authStyles as styles } from '@/components/authStyles';
import { PublicIntro } from '@/components/PublicIntro';
import { Screen } from '@/components/Screen';
import { Button, ErrorText, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';

export default function SignInScreen() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    if (!email.trim() || !password) {
      setError(t('common.required'));
      return;
    }
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) setError(error.message);
  };

  return (
    <Screen>
      <LanguageSwitcher />
      <Text style={styles.title}>{t('auth.signInTitle')}</Text>
      <Text style={styles.subtitle}>{t('auth.subtitle')}</Text>
      <Field
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <Field
        label={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
      />
      <ErrorText>{error}</ErrorText>
      <Button title={t('auth.signIn')} onPress={signIn} loading={loading} />
      <Link href="/sign-up" style={styles.link}>
        {t('auth.noAccount')}
      </Link>
      <PublicIntro />
    </Screen>
  );
}
