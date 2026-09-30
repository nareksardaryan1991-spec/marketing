import { useI18n } from '@/i18n';
import type { Business } from '@/lib/types';

import { Field } from './ui';

export const BUSINESS_FIELDS = [
  'name',
  'industry',
  'city',
  'description',
  'target_audience',
  'tone',
  'goals',
  'competitors',
  'instagram_url',
  'facebook_url',
  'tiktok_url',
  'website_url',
] as const;

export type BusinessFormKey = (typeof BUSINESS_FIELDS)[number];
export type BusinessForm = Record<BusinessFormKey, string>;

export function businessForm(business?: Business | null): BusinessForm {
  return Object.fromEntries(
    BUSINESS_FIELDS.map((key) => [key, business?.[key] ?? '']),
  ) as BusinessForm;
}

// Пустые поля сохраняем как null.
export function businessValues(form: BusinessForm): Record<BusinessFormKey, string | null> {
  return Object.fromEntries(
    BUSINESS_FIELDS.map((key) => [key, form[key].trim() || null]),
  ) as Record<BusinessFormKey, string | null>;
}

export function businessFormValid(form: BusinessForm): boolean {
  return !!form.name.trim() && !!form.industry.trim();
}

export type BusinessStep = 1 | 2 | 3;

// Поля анкеты одного шага: 1 — о бизнесе, 2 — аудитория и стиль, 3 — соцсети.
export function BusinessFields({
  step,
  form,
  onChange,
}: {
  step: BusinessStep;
  form: BusinessForm;
  onChange: (form: BusinessForm) => void;
}) {
  const { t } = useI18n();
  const bind = (key: BusinessFormKey) => ({
    value: form[key],
    onChangeText: (text: string) => onChange({ ...form, [key]: text }),
  });
  const url = { autoCapitalize: 'none', keyboardType: 'url' } as const;

  if (step === 1) {
    return (
      <>
        <Field label={t('onboarding.name')} {...bind('name')} />
        <Field
          label={t('onboarding.industry')}
          hint={t('onboarding.industryHint')}
          {...bind('industry')}
        />
        <Field label={t('onboarding.city')} {...bind('city')} />
        <Field label={t('onboarding.description')} multiline {...bind('description')} />
      </>
    );
  }

  if (step === 2) {
    return (
      <>
        <Field
          label={t('onboarding.targetAudience')}
          hint={t('onboarding.targetAudienceHint')}
          multiline
          {...bind('target_audience')}
        />
        <Field label={t('onboarding.tone')} hint={t('onboarding.toneHint')} {...bind('tone')} />
        <Field
          label={t('onboarding.goals')}
          hint={t('onboarding.goalsHint')}
          multiline
          {...bind('goals')}
        />
        <Field label={t('onboarding.competitors')} multiline {...bind('competitors')} />
      </>
    );
  }

  return (
    <>
      <Field
        label={t('onboarding.instagram')}
        hint="https://instagram.com/…"
        {...url}
        {...bind('instagram_url')}
      />
      <Field
        label={t('onboarding.facebook')}
        hint="https://facebook.com/…"
        {...url}
        {...bind('facebook_url')}
      />
      <Field
        label={t('onboarding.tiktok')}
        hint="https://tiktok.com/@…"
        {...url}
        {...bind('tiktok_url')}
      />
      <Field label={t('onboarding.website')} hint="https://…" {...url} {...bind('website_url')} />
    </>
  );
}
