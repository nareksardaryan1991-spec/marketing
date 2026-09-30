import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import {
  BusinessFields,
  businessForm,
  businessFormValid,
  businessValues,
  type BusinessForm,
} from '@/components/BusinessFields';
import { Screen } from '@/components/Screen';
import { taskStyles as styles } from '@/components/task/styles';
import { colors } from '@/components/theme';
import { Button, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import type { Business } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

// Анкета бизнеса: клиент правит свою, менеджер — любую (?id=…).
export default function BusinessScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { t } = useI18n();
  const { business: own, refresh } = useAuth();
  const businessId = id ?? own?.id;
  const [form, setForm] = useState<BusinessForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    supabase
      .from('businesses')
      .select('*')
      .eq('id', businessId)
      .single<Business>()
      .then(({ data, error }) => {
        setError(error?.message ?? null);
        if (data) setForm(businessForm(data));
      });
  }, [businessId]);

  if (!form) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        {error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const save = async () => {
    if (!businessFormValid(form)) {
      setError(t('common.required'));
      return;
    }
    setError(null);
    setSaving(true);
    const { error } = await supabase
      .from('businesses')
      .update(businessValues(form))
      .eq('id', businessId!);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (businessId === own?.id) await refresh();
    setSaved(true);
    if (router.canGoBack()) router.back();
  };

  const edit = (next: BusinessForm) => {
    setForm(next);
    setSaved(false);
  };

  return (
    <Screen>
      <Text style={styles.label}>{t('onboarding.stepAbout')}</Text>
      <BusinessFields step={1} form={form} onChange={edit} />
      <Text style={styles.label}>{t('onboarding.stepAudience')}</Text>
      <BusinessFields step={2} form={form} onChange={edit} />
      <Text style={styles.label}>{t('onboarding.stepSocial')}</Text>
      <BusinessFields step={3} form={form} onChange={edit} />
      <ErrorText>{error}</ErrorText>
      {saved && <Text style={{ color: colors.primary }}>{t('business.saved')}</Text>}
      <Button title={t('common.save')} onPress={save} loading={saving} />
      {id && (
        <Button
          title={t('reports.title')}
          variant="ghost"
          onPress={() => router.push({ pathname: '/reports', params: { business: id } })}
        />
      )}
    </Screen>
  );
}
