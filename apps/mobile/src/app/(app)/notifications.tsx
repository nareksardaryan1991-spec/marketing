import { useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

import { Screen } from '@/components/Screen';
import { taskStyles as styles } from '@/components/task/styles';
import { Button, Card, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { registerPush, type PushStatus } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

const BOT = process.env.EXPO_PUBLIC_TELEGRAM_BOT;

export default function NotificationsScreen() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!profile) return;
    supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('id', profile.id)
      .single()
      .then(({ data }) => setTelegramLinked(!!data?.telegram_chat_id));
  }, [profile]);

  useFocusEffect(load);

  const connectTelegram = async () => {
    setError(null);
    const { data, error } = await supabase.rpc('create_telegram_link_code');
    if (error) {
      setError(error.message);
      return;
    }
    await WebBrowser.openBrowserAsync(`https://t.me/${BOT}?start=${data}`);
    load();
  };

  const enablePush = async () => {
    if (profile) setPush(await registerPush(profile.id, true));
  };

  return (
    <Screen>
      <Card>
        <Text style={styles.cardTitle}>Telegram</Text>
        <Text style={styles.muted}>
          {telegramLinked ? t('notify.telegramLinked') : t('notify.telegramHint')}
        </Text>
        {BOT ? (
          <Button
            title={telegramLinked ? t('notify.telegramRelink') : t('notify.telegramConnect')}
            variant={telegramLinked ? 'ghost' : 'primary'}
            onPress={connectTelegram}
          />
        ) : (
          <Text style={styles.muted}>{t('notify.telegramNotConfigured')}</Text>
        )}
        <Button title={t('order.refresh')} variant="ghost" onPress={load} />
      </Card>
      <Card>
        <Text style={styles.cardTitle}>{t('notify.push')}</Text>
        {push && <Text style={styles.muted}>{t(`notify.pushStatus.${push}`)}</Text>}
        <Button title={t('notify.pushEnable')} variant="ghost" onPress={enablePush} />
      </Card>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
