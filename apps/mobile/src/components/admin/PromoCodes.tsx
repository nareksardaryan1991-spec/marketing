import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { formatAmd, formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { PromoCode } from '@/lib/types';

import { Choice } from '../Choice';
import { taskStyles } from '../task/styles';
import { colors } from '../theme';
import { Button, Card, ErrorText, Field } from '../ui';

// Владелец: промокоды — создать, выключить, сколько раз использован.
export function PromoCodes() {
  const { t, language } = useI18n();
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    supabase
      .from('promo_codes')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setCodes((data as PromoCode[] | null) ?? []);
      });
  }, []);

  useEffect(load, [load]);

  const create = async () => {
    const normalized = code.trim().toUpperCase();
    const amount = Number(value);
    const uses = maxUses ? Number(maxUses) : null;
    if (!/^[A-Z0-9_-]{3,32}$/.test(normalized)) return setError(t('promo.invalidCode'));
    if (!Number.isInteger(amount) || amount <= 0 || (kind === 'percent' && amount > 99)) {
      return setError(t('promo.invalidValue'));
    }
    if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil.trim())) {
      return setError(t('promo.invalidDate'));
    }
    setError(null);
    setSaving(true);
    const { error } = await supabase.from('promo_codes').insert({
      code: normalized,
      percent: kind === 'percent' ? amount : null,
      amount_amd: kind === 'amount' ? amount : null,
      max_uses: uses,
      valid_until: validUntil.trim() || null,
    });
    setSaving(false);
    if (error) return setError(error.message);
    setCode('');
    setValue('');
    setMaxUses('');
    setValidUntil('');
    load();
  };

  const toggle = async (promo: PromoCode) => {
    const { error } = await supabase
      .from('promo_codes')
      .update({ active: !promo.active })
      .eq('code', promo.code);
    if (error) setError(error.message);
    else load();
  };

  return (
    <Card>
      <Text style={taskStyles.cardTitle}>{t('promo.title')}</Text>
      <Text style={taskStyles.muted}>{t('promo.adminHint')}</Text>
      {codes.map((p) => (
        <View key={p.code} style={styles.row}>
          <View style={styles.texts}>
            <Text style={[styles.code, !p.active && styles.off]}>
              {p.code} · {p.percent ? `−${p.percent}%` : `−${formatAmd(p.amount_amd ?? 0, language)}`}
            </Text>
            <Text style={taskStyles.muted}>
              {p.max_uses
                ? t('promo.used', { used: p.used_count, max: p.max_uses })
                : t('promo.usedUnlimited', { used: p.used_count })}
              {p.valid_until ? ` · ${t('promo.until', { date: formatDate(p.valid_until, language) })}` : ''}
              {p.active ? '' : ` · ${t('promo.off')}`}
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => toggle(p)}>
            <Text style={styles.link}>{p.active ? t('promo.disable') : t('promo.enable')}</Text>
          </Pressable>
        </View>
      ))}

      <Text style={[taskStyles.cardTitle, styles.newTitle]}>{t('promo.new')}</Text>
      <Field
        label={t('promo.code')}
        hint="AUTUMN10"
        autoCapitalize="characters"
        autoCorrect={false}
        value={code}
        onChangeText={setCode}
      />
      <Choice
        options={[
          { value: 'percent', label: t('promo.percent') },
          { value: 'amount', label: t('promo.amount') },
        ]}
        value={kind}
        onChange={setKind}
      />
      <Field
        label={kind === 'percent' ? t('promo.percent') : t('promo.amount')}
        keyboardType="number-pad"
        value={value}
        onChangeText={(v) => setValue(v.replace(/\D/g, ''))}
      />
      <Field
        label={t('promo.maxUses')}
        keyboardType="number-pad"
        value={maxUses}
        onChangeText={(v) => setMaxUses(v.replace(/\D/g, ''))}
      />
      <Field
        label={t('promo.validUntil')}
        hint="2026-12-31"
        value={validUntil}
        onChangeText={setValidUntil}
      />
      <ErrorText>{error}</ErrorText>
      <Button title={t('promo.create')} onPress={create} loading={saving} />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  texts: { flex: 1, gap: 2 },
  code: { fontSize: 16, fontWeight: '700', color: colors.text },
  off: { color: colors.muted, textDecorationLine: 'line-through' },
  link: { fontSize: 15, color: colors.primary },
  newTitle: { marginTop: 8 },
});
