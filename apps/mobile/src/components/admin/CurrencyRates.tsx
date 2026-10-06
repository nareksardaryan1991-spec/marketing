import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { useI18n } from '@/i18n';
import { loadRates } from '@/lib/money';
import { supabase } from '@/lib/supabase';

import { taskStyles as styles } from '../task/styles';
import { Button, Card, ErrorText, Field } from '../ui';

// Владелец: курс для показа цен в $ и € (сколько драмов за 1 единицу). Платят всегда в драмах.
export function CurrencyRates() {
  const { t } = useI18n();
  const [usd, setUsd] = useState('');
  const [eur, setEur] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadRates(true).then((r) => {
      if (!r) return;
      setUsd(String(r.USD));
      setEur(String(r.EUR));
    });
  }, []);

  const save = async () => {
    const values = { usd_rate_amd: Number(usd.replace(',', '.')), eur_rate_amd: Number(eur.replace(',', '.')) };
    if (!(values.usd_rate_amd > 0 && values.eur_rate_amd > 0)) {
      setError(t('money.rateInvalid'));
      return;
    }
    setError(null);
    setSaving(true);
    const { error } = await supabase.from('agency_settings').update(values).eq('id', true);
    setSaving(false);
    if (error) return setError(error.message);
    await loadRates(true);
    setSaved(true);
  };

  const edit = (setter: (v: string) => void) => (v: string) => {
    setter(v.replace(/[^\d.,]/g, ''));
    setSaved(false);
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>{t('money.ratesTitle')}</Text>
      <Text style={styles.muted}>{t('money.ratesHint')}</Text>
      <Field label={t('money.usdRate')} keyboardType="decimal-pad" value={usd} onChangeText={edit(setUsd)} />
      <Field label={t('money.eurRate')} keyboardType="decimal-pad" value={eur} onChangeText={edit(setEur)} />
      <ErrorText>{error}</ErrorText>
      {saved && <Text style={styles.muted}>✓ {t('approvals.saved')}</Text>}
      <Button title={t('common.save')} variant="ghost" onPress={save} loading={saving} />
    </Card>
  );
}
