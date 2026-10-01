import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { useI18n } from '@/i18n';
import { loadAutoApproveDays } from '@/lib/approvals';
import { supabase } from '@/lib/supabase';

import { taskStyles as styles } from '../task/styles';
import { Button, Card, ErrorText, Field } from '../ui';

// Владелец: через сколько дней молчания клиента материал одобряется сам (0 — выключено).
export function AutoApproveSetting() {
  const { t } = useI18n();
  const [days, setDays] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAutoApproveDays().then((d) => setDays(String(d)));
  }, []);

  const save = async () => {
    const value = Number(days);
    if (!Number.isInteger(value) || value < 0 || value > 60) {
      setError(t('approvals.daysInvalid'));
      return;
    }
    setError(null);
    setSaving(true);
    const { error } = await supabase
      .from('agency_settings')
      .update({ auto_approve_days: value })
      .eq('id', true);
    setSaving(false);
    if (error) setError(error.message);
    else setSaved(true);
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>{t('approvals.settingsTitle')}</Text>
      <Text style={styles.muted}>{t('approvals.settingsHint')}</Text>
      <Field
        label={t('approvals.days')}
        keyboardType="number-pad"
        value={days}
        onChangeText={(v) => {
          setDays(v.replace(/\D/g, ''));
          setSaved(false);
        }}
      />
      <ErrorText>{error}</ErrorText>
      {saved && <Text style={styles.muted}>✓ {t('approvals.saved')}</Text>}
      <Button title={t('common.save')} variant="ghost" onPress={save} loading={saving} />
    </Card>
  );
}
