import { Link } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { Choice } from '@/components/Choice';

import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { authStyles as styles } from '@/components/authStyles';
import { Screen } from '@/components/Screen';
import { Button, Card, ErrorText, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';

export default function SignUpScreen() {
  const { t, language } = useI18n();
  const [accountType, setAccountType] = useState<'client' | 'staff'>('client');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const signUp = async () => {
    if (!fullName.trim() || !email.trim() || !password) {
      setError(t('common.required'));
      return;
    }
    if (password.length < 6) {
      setError(t('auth.passwordShort'));
      return;
    }
    setError(null);
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // Роль сотрудника назначает владелец; здесь только отметка «я сотрудник».
      options: { data: { full_name: fullName.trim(), language, account_type: accountType } },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Если в Supabase включено подтверждение email, сессии ещё нет.
    if (!data.session) setSentTo(email.trim());
  };

  return (
    <Screen>
      <LanguageSwitcher />
      <Text style={styles.title}>{t('auth.signUpTitle')}</Text>
      <Text style={styles.subtitle}>{t('auth.subtitle')}</Text>
      {sentTo ? (
        <Card>
          <Text style={styles.info}>{t('auth.checkEmail', { email: sentTo })}</Text>
        </Card>
      ) : (
        <>
          <Choice
            value={accountType}
            onChange={setAccountType}
            options={[
              { value: 'client', label: t('auth.iAmClient'), hint: t('auth.iAmClientHint') },
              { value: 'staff', label: t('auth.iAmStaff'), hint: t('auth.iAmStaffHint') },
            ]}
          />
          <Field
            label={t('auth.fullName')}
            value={fullName}
            onChangeText={setFullName}
            autoComplete="name"
          />
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
            autoComplete="new-password"
          />
          <ErrorText>{error}</ErrorText>
          <Button title={t('auth.signUp')} onPress={signUp} loading={loading} />
        </>
      )}
      <Link href="/sign-in" style={styles.link}>
        {t('auth.haveAccount')}
      </Link>
    </Screen>
  );
}
