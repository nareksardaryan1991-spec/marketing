import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  BusinessFields,
  businessForm,
  businessFormValid,
  businessValues,
  type BusinessStep,
} from '@/components/BusinessFields';
import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { Button, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

const TOTAL_STEPS = 3;

export default function OnboardingScreen() {
  const { t } = useI18n();
  const { session, refresh } = useAuth();
  const [step, setStep] = useState<BusinessStep>(1);
  const [form, setForm] = useState(businessForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const next = () => {
    if (step === 1 && !businessFormValid(form)) {
      setError(t('common.required'));
      return;
    }
    setError(null);
    setStep((s) => (s + 1) as BusinessStep);
  };

  const finish = async () => {
    if (!session) return;
    setError(null);
    setSaving(true);
    const { error } = await supabase
      .from('businesses')
      .insert({ ...businessValues(form), owner_id: session.user.id });
    if (error) {
      setSaving(false);
      setError(error.message);
      return;
    }
    // После обновления бизнес появится в AuthProvider, и навигатор сам откроет главную.
    await refresh();
  };

  const stepTitle = [t('onboarding.stepAbout'), t('onboarding.stepAudience'), t('onboarding.stepSocial')][
    step - 1
  ];

  return (
    <Screen>
      <Text style={styles.title}>{t('onboarding.title')}</Text>
      <View style={styles.progressRow}>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <View key={i} style={[styles.progress, i < step && styles.progressActive]} />
        ))}
      </View>
      <Text style={styles.step}>
        {t('onboarding.step', { current: step, total: TOTAL_STEPS })} · {stepTitle}
      </Text>

      <BusinessFields step={step} form={form} onChange={setForm} />

      <ErrorText>{error}</ErrorText>
      {step < TOTAL_STEPS ? (
        <Button title={t('common.next')} onPress={next} />
      ) : (
        <Button title={t('onboarding.finish')} onPress={finish} loading={saving} />
      )}
      {step > 1 && (
        <Button
          title={t('common.back')}
          variant="ghost"
          onPress={() => setStep((s) => (s - 1) as BusinessStep)}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '700', color: colors.text, marginTop: 16 },
  progressRow: { flexDirection: 'row', gap: 6 },
  progress: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
  progressActive: { backgroundColor: colors.primary },
  step: { fontSize: 14, color: colors.muted },
});
