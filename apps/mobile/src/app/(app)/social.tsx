import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

import { Screen } from '@/components/Screen';
import { taskStyles as styles } from '@/components/task/styles';
import { colors } from '@/components/theme';
import { Button, Card, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDate } from '@/lib/format';
import { connectInstagram } from '@/lib/instagram';
import { supabase } from '@/lib/supabase';
import { SOCIAL_ACCOUNT_COLUMNS, type SocialAccount } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

// Подключение Instagram для автопубликации.
export default function SocialScreen() {
  const { t, language } = useI18n();
  const { business } = useAuth();
  const params = useLocalSearchParams<{ instagram?: string }>();
  const [account, setAccount] = useState<SocialAccount | null>(null);
  const [result, setResult] = useState<string | null>(params.instagram ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!business) return;
    supabase
      .from('social_accounts')
      .select(SOCIAL_ACCOUNT_COLUMNS)
      .eq('business_id', business.id)
      .eq('platform', 'instagram')
      .maybeSingle<SocialAccount>()
      .then(({ data, error }) => {
        setError(error?.message ?? null);
        setAccount(data ?? null);
      });
  }, [business]);

  useFocusEffect(load);

  if (!business) return null;

  const connect = async () => {
    setError(null);
    setBusy(true);
    try {
      const outcome = await connectInstagram(business.id);
      if (outcome) setResult(outcome);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setError(null);
    const { error } = await supabase.rpc('disconnect_social_account', {
      p_business_id: business.id,
    });
    if (error) setError(error.message);
    setResult(null);
    load();
  };

  const resultText =
    result === 'connected'
      ? t('social.connected')
      : result === 'cancelled'
        ? t('social.cancelled')
        : result
          ? t('social.failed')
          : null;

  return (
    <Screen>
      <Card>
        <Text style={styles.cardTitle}>Instagram</Text>
        <Text style={styles.muted}>{t('social.hint')}</Text>
        {account ? (
          <>
            <Text style={styles.text}>@{account.username}</Text>
            <Text style={styles.muted}>
              {t('social.since', { date: formatDate(account.created_at, language) })}
            </Text>
            <Button title={t('social.reconnect')} variant="ghost" onPress={connect} loading={busy} />
            <Button title={t('social.disconnect')} variant="ghost" onPress={disconnect} />
          </>
        ) : (
          <Button title={t('social.connect')} onPress={connect} loading={busy} />
        )}
        {resultText && (
          <Text style={{ color: result === 'connected' ? colors.primary : colors.danger }}>
            {resultText}
          </Text>
        )}
        <ErrorText>{error}</ErrorText>
      </Card>
      <Card>
        <Text style={styles.cardTitle}>{t('social.requirementsTitle')}</Text>
        <Text style={styles.muted}>{t('social.requirements')}</Text>
      </Card>
    </Screen>
  );
}
