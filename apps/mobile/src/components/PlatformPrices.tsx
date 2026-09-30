import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useI18n } from '@/i18n';
import { serviceLabel } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import type { Platform, PlatformService, Service } from '@/lib/types';

import { colors } from './theme';
import { Button, Card, ErrorText } from './ui';

type Row = PlatformService & { draft: string };

// Цены постов, историй и рилсов для каждой площадки.
export function PlatformPrices({ services }: { services: Service[] }) {
  const { t, language } = useI18n();
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      supabase.from('platforms').select('*').order('sort_order'),
      supabase.from('platform_services').select('*'),
    ]).then(([p, ps]) => {
      setError(p.error?.message ?? ps.error?.message ?? null);
      setPlatforms((p.data as Platform[] | null) ?? []);
      setRows(
        ((ps.data as PlatformService[] | null) ?? []).map((r) => ({ ...r, draft: String(r.price_amd) })),
      );
    });
  }, []);

  useEffect(load, [load]);

  const serviceById = new Map(services.map((s) => [s.id, s]));
  const update = (row: Row, patch: Partial<Row>) => {
    setSaved(false);
    setRows((prev) =>
      prev.map((r) =>
        r.platform_id === row.platform_id && r.service_id === row.service_id ? { ...r, ...patch } : r,
      ),
    );
  };

  const save = async () => {
    const invalid = rows.find((r) => !/^\d+$/.test(r.draft.replace(/\s/g, '')));
    if (invalid) {
      setError(t('services.invalid'));
      return;
    }
    setError(null);
    setSaving(true);
    const results = await Promise.all(
      rows.map((r) =>
        supabase
          .from('platform_services')
          .update({ price_amd: Number(r.draft.replace(/\s/g, '')), active: r.active })
          .eq('platform_id', r.platform_id)
          .eq('service_id', r.service_id),
      ),
    );
    setSaving(false);
    const failed = results.find((r) => r.error);
    if (failed?.error) setError(failed.error.message);
    else {
      setSaved(true);
      load();
    }
  };

  return (
    <Card>
      <Text style={styles.title}>{t('services.platformPrices')}</Text>
      <Text style={styles.muted}>{t('services.platformPricesHint')}</Text>
      {platforms.map((platform) => (
        <View key={platform.id} style={styles.platform}>
          <Text style={styles.platformName}>{platform.name}</Text>
          {rows
            .filter((r) => r.platform_id === platform.id)
            .sort(
              (a, b) =>
                (serviceById.get(a.service_id)?.sort_order ?? 0) -
                (serviceById.get(b.service_id)?.sort_order ?? 0),
            )
            .map((row) => (
              <View key={row.service_id} style={styles.row}>
                <Text style={[styles.service, !row.active && styles.inactive]}>
                  {serviceLabel(row.service_id, serviceById.get(row.service_id)?.name, row.platform_id, language)}
                </Text>
                <TextInput
                  accessibilityLabel={`${platform.name} ${row.service_id} ${t('services.price')}`}
                  keyboardType="number-pad"
                  value={row.draft}
                  onChangeText={(draft) => update(row, { draft })}
                  style={styles.input}
                />
                <Text style={styles.currency}>֏</Text>
                <Switch value={row.active} onValueChange={(active) => update(row, { active })} />
              </View>
            ))}
        </View>
      ))}
      <ErrorText>{error}</ErrorText>
      {saved && <Text style={{ color: colors.primary }}>{t('business.saved')}</Text>}
      <Button title={t('common.save')} onPress={save} loading={saving} />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  platform: { gap: 6, paddingTop: 8 },
  platformName: { fontSize: 16, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  service: { flex: 1, fontSize: 15, color: colors.text },
  inactive: { color: colors.muted, textDecorationLine: 'line-through' },
  input: {
    width: 96,
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    fontSize: 15,
    color: colors.text,
    textAlign: 'right',
    backgroundColor: colors.surface,
  },
  currency: { fontSize: 15, color: colors.muted },
});
