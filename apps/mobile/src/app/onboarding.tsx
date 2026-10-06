import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AgentAvatar, agentLabel } from '@/components/agents/AgentAvatar';
import { BrandFields } from '@/components/BrandFields';
import { businessForm, businessValues, type BusinessForm, type BusinessFormKey } from '@/components/BusinessFields';
import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { Button, ErrorText, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { agentById, type AgentId } from '@/lib/agents';
import { pickLogo, removeLogo } from '@/lib/brand';
import { startWelcome } from '@/lib/clientAi';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

// Знакомство — разговор с командой: агенты по очереди задают короткие вопросы, по одному на экран.
// Ответы сразу сохраняются в профиль бизнеса (после второго вопроса бизнес уже создан), поэтому
// закрытое на середине знакомство продолжится с того же места.
type Step = {
  key: string;
  agent: AgentId;
  fields: BusinessFormKey[];
  required?: boolean;
  multiline?: boolean;
  // Подсказки-кнопки: single — заменяют ответ, multi — добавляются через запятую.
  chips?: 'single' | 'multi';
  brand?: boolean;
};

const STEPS: Step[] = [
  { key: 'name', agent: 'smm', fields: ['name'], required: true },
  { key: 'industry', agent: 'smm', fields: ['industry'], required: true, chips: 'single' },
  { key: 'city', agent: 'targetologist', fields: ['city'], chips: 'single' },
  { key: 'description', agent: 'seo', fields: ['description'], multiline: true },
  { key: 'target_audience', agent: 'targetologist', fields: ['target_audience'], multiline: true },
  { key: 'tone', agent: 'smm', fields: ['tone'], chips: 'multi' },
  { key: 'goals', agent: 'targetologist', fields: ['goals'], chips: 'multi' },
  { key: 'links', agent: 'seo', fields: ['instagram_url', 'facebook_url', 'tiktok_url', 'website_url'] },
  { key: 'brand', agent: 'designer', fields: [], brand: true },
  { key: 'example_posts', agent: 'scriptwriter', fields: ['example_posts'], multiline: true },
];

const URL_FIELDS: Partial<Record<BusinessFormKey, string>> = {
  instagram_url: 'https://instagram.com/…',
  facebook_url: 'https://facebook.com/…',
  tiktok_url: 'https://tiktok.com/@…',
  website_url: 'https://…',
};

export default function OnboardingScreen() {
  const { t, language } = useI18n();
  const { session, business, refresh } = useAuth();
  const [businessId, setBusinessId] = useState<string | null>(business?.id ?? null);
  const [form, setForm] = useState<BusinessForm>(() => businessForm(business));
  const [brandColors, setBrandColors] = useState<string[]>(business?.brand_colors ?? []);
  const [logoPath, setLogoPath] = useState<string | null>(business?.logo_path ?? null);
  // Бизнес уже создан (знакомство прервали) — продолжаем после обязательных вопросов.
  const [index, setIndex] = useState(business ? 2 : 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const step = STEPS[index];
  const agent = agentById(step.agent)!;
  const last = index === STEPS.length - 1;
  const filled = step.fields.some((f) => form[f].trim());

  const values = (keys: BusinessFormKey[]) => {
    const all = businessValues(form);
    return Object.fromEntries(keys.map((k) => [k, all[k]]));
  };

  // Сохраняем ответы этого шага; после вопроса о сфере создаём бизнес.
  const save = async () => {
    if (!session) return;
    if (!businessId) {
      if (step.key !== 'industry') return;
      const { data, error } = await supabase
        .from('businesses')
        .insert({ ...values(['name', 'industry']), owner_id: session.user.id })
        .select('id')
        .single();
      if (error) throw error;
      setBusinessId(data.id);
      return;
    }
    const patch = step.brand ? { brand_colors: brandColors } : values(step.fields);
    const { error } = await supabase.from('businesses').update(patch).eq('id', businessId);
    if (error) throw error;
  };

  const next = async (skip = false) => {
    if (!skip && step.required && !filled) {
      setError(t('common.required'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (!skip) await save();
      if (!last) {
        setIndex(index + 1);
        return;
      }
      // Знакомство закончено: отмечаем и просим команду подготовить подарок.
      const { error } = await supabase
        .from('businesses')
        .update({ onboarded_at: new Date().toISOString() })
        .eq('id', businessId!);
      if (error) throw error;
      // Если AI сейчас недоступен — на главной будет кнопка «Повторить».
      await startWelcome(language).catch(() => {});
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changeLogo = async () => {
    if (!businessId) return;
    setError(null);
    setUploading(true);
    try {
      const path = await pickLogo(businessId);
      if (path) {
        const { error } = await supabase.from('businesses').update({ logo_path: path }).eq('id', businessId);
        if (error) throw error;
        await removeLogo(logoPath);
        setLogoPath(path);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const deleteLogo = async () => {
    if (!businessId) return;
    const { error } = await supabase.from('businesses').update({ logo_path: null }).eq('id', businessId);
    if (error) return setError(error.message);
    await removeLogo(logoPath);
    setLogoPath(null);
  };

  const pickChip = (field: BusinessFormKey, chip: string) => {
    if (step.chips === 'single') {
      setForm({ ...form, [field]: chip });
      return;
    }
    const parts = form[field].split(',').map((p) => p.trim()).filter(Boolean);
    const next = parts.includes(chip) ? parts.filter((p) => p !== chip) : [...parts, chip];
    setForm({ ...form, [field]: next.join(', ') });
  };

  const chips = step.chips ? (t(`meet.chips.${step.key}`) as string).split('|') : [];
  const field = step.fields[0];

  return (
    <Screen>
      <View style={styles.progressRow} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: STEPS.length, now: index + 1 }}>
        {STEPS.map((s, i) => (
          <View key={s.key} style={[styles.progress, i <= index && styles.progressActive]} />
        ))}
      </View>
      <Text style={styles.counter}>{t('meet.counter', { current: index + 1, total: STEPS.length })}</Text>

      <View style={styles.agentRow}>
        <AgentAvatar agent={agent} size={48} />
        <Text style={styles.agentName}>{agentLabel(t, agent)}</Text>
      </View>
      <View style={[styles.bubble, { borderColor: agent.color }]}>
        <Text style={styles.question}>{t(`meet.q.${step.key}`)}</Text>
      </View>

      {step.brand ? (
        <BrandFields
          logoPath={logoPath}
          brandColors={brandColors}
          onPickLogo={changeLogo}
          onRemoveLogo={deleteLogo}
          onChangeColors={setBrandColors}
          uploading={uploading}
        />
      ) : step.fields.length > 1 ? (
        step.fields.map((f) => (
          <Field
            key={f}
            label={t(`onboarding.${f.replace('_url', '')}`)}
            hint={URL_FIELDS[f]}
            autoCapitalize="none"
            keyboardType="url"
            value={form[f]}
            onChangeText={(text) => setForm({ ...form, [f]: text })}
          />
        ))
      ) : (
        <>
          <Field
            label={t('meet.answer')}
            hint={t(`meet.hint.${step.key}`)}
            multiline={step.multiline}
            autoFocus
            value={form[field]}
            onChangeText={(text) => setForm({ ...form, [field]: text })}
          />
          {chips.length > 0 && (
            <View style={styles.chips}>
              {chips.map((chip) => {
                const on =
                  step.chips === 'single'
                    ? form[field].trim() === chip
                    : form[field].split(',').map((p) => p.trim()).includes(chip);
                return (
                  <Pressable
                    key={chip}
                    accessibilityRole={step.chips === 'single' ? 'radio' : 'checkbox'}
                    accessibilityState={{ checked: on }}
                    onPress={() => pickChip(field, chip)}
                    style={[styles.chip, on && { borderColor: agent.color, backgroundColor: colors.surface }]}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{chip}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </>
      )}

      <ErrorText>{error}</ErrorText>
      <Button title={last ? t('meet.finish') : t('common.next')} onPress={() => next()} loading={busy} />
      {!step.required && (
        <Button title={last ? t('meet.finishSkip') : t('meet.skip')} variant="ghost" onPress={() => next(true)} />
      )}
      {index > 0 && (
        <Button title={t('common.back')} variant="ghost" onPress={() => setIndex(index - 1)} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  progressRow: { flexDirection: 'row', gap: 4, marginTop: 16 },
  progress: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
  progressActive: { backgroundColor: colors.primary },
  counter: { fontSize: 14, color: colors.muted },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  agentName: { fontSize: 15, fontWeight: '600', color: colors.text },
  bubble: {
    padding: 16,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    borderLeftWidth: 4,
    backgroundColor: colors.surface,
  },
  question: { fontSize: 18, lineHeight: 26, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chipText: { fontSize: 15, color: colors.text },
  chipTextOn: { fontWeight: '600' },
});
