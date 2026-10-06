import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { formatAmd, localized } from '@/lib/format';
import { serviceLabel } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import type { Language, Localized, Package, Platform, PlatformService, Service } from '@/lib/types';

import { Choice } from '../Choice';
import { catalogPrice } from '../PackagePicker';
import { Stepper } from '../Stepper';
import { taskStyles as styles } from '../task/styles';
import { colors } from '../theme';
import { Button, Card, ErrorText, Field } from '../ui';

type Catalog = { platforms: Platform[]; offers: PlatformService[]; services: Service[] };
const LANGS: Language[] = ['ru', 'hy', 'en'];
const key = (platformId: string | null, serviceId: string) => `${platformId ?? ''}:${serviceId}`;

// Менеджер и владелец: пакеты на месяц — состав из услуг каталога и цена за месяц.
export function PackagesEditor() {
  const { t } = useI18n();
  const [packages, setPackages] = useState<Package[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, platforms, offers, services] = await Promise.all([
      supabase.from('packages').select('*, package_items(*)').order('sort_order'),
      supabase.from('platforms').select('*').eq('active', true).order('sort_order'),
      supabase.from('platform_services').select('*').eq('active', true),
      supabase.from('services').select('*').eq('active', true).order('sort_order'),
    ]);
    setError(p.error?.message ?? null);
    setPackages((p.data as Package[] | null) ?? []);
    setCatalog({
      platforms: (platforms.data as Platform[] | null) ?? [],
      offers: (offers.data as PlatformService[] | null) ?? [],
      services: (services.data as Service[] | null) ?? [],
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const add = async () => {
    const { data, error } = await supabase
      .from('packages')
      .insert({
        name: { ru: t('packages.newName') },
        price_amd: 50000,
        active: false,
        sort_order: (packages.at(-1)?.sort_order ?? 0) + 10,
      })
      .select('id')
      .single();
    if (error) return setError(error.message);
    await load();
    setOpen(data.id);
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>{t('packages.editorTitle')}</Text>
      <Text style={styles.muted}>{t('packages.editorHint')}</Text>
      <ErrorText>{error}</ErrorText>
      {catalog &&
        packages.map((pkg) =>
          open === pkg.id ? (
            <PackageForm key={pkg.id} pkg={pkg} catalog={catalog} onDone={() => (setOpen(null), load())} />
          ) : (
            <PackageRow key={pkg.id} pkg={pkg} catalog={catalog} onPress={() => setOpen(pkg.id)} />
          ),
        )}
      <Button title={t('packages.add')} variant="ghost" onPress={add} />
    </Card>
  );
}

function PackageRow({ pkg, catalog, onPress }: { pkg: Package; catalog: Catalog; onPress: () => void }) {
  const { t, language } = useI18n();
  const full = catalogPrice(pkg, catalog);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={local.row}>
      <View style={local.texts}>
        <Text style={local.name}>
          {localized(pkg.name, language)}
          {!pkg.active ? ` · ${t('packages.hidden')}` : ''}
        </Text>
        <Text style={styles.muted}>
          {formatAmd(pkg.price_amd, language)} {t('order.perMonth')}
          {full > pkg.price_amd ? ` · ${t('packages.catalog', { amount: formatAmd(full, language) })}` : ''}
        </Text>
      </View>
      <Text style={local.edit}>{t('packages.edit')}</Text>
    </Pressable>
  );
}

function PackageForm({ pkg, catalog, onDone }: { pkg: Package; catalog: Catalog; onDone: () => void }) {
  const { t, language } = useI18n();
  const [name, setName] = useState<Localized>(pkg.name);
  const [description, setDescription] = useState<Localized>(pkg.description ?? {});
  const [price, setPrice] = useState(String(pkg.price_amd));
  const [active, setActive] = useState(pkg.active ? 'yes' : 'no');
  const [quantities, setQuantities] = useState<Record<string, number>>(
    Object.fromEntries(pkg.package_items.map((i) => [key(i.platform_id, i.service_id), i.quantity])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const lines = [
    ...catalog.offers.map((o) => ({ platformId: o.platform_id as string | null, serviceId: o.service_id, price: o.price_amd })),
    ...catalog.services.filter((s) => !s.per_platform).map((s) => ({ platformId: null, serviceId: s.id, price: s.price_amd })),
  ];
  const items = lines
    .map((l) => ({ ...l, quantity: quantities[key(l.platformId, l.serviceId)] ?? 0 }))
    .filter((l) => l.quantity > 0);
  const full = items.reduce((sum, l) => sum + l.price * l.quantity, 0);

  const save = async () => {
    const amount = Number(price.replace(/\D/g, ''));
    if (!name.ru?.trim() || !(amount > 0) || !items.length) {
      setError(t('packages.invalid'));
      return;
    }
    setError(null);
    setSaving(true);
    const { error } = await supabase
      .from('packages')
      .update({ name, description, price_amd: amount, active: active === 'yes' })
      .eq('id', pkg.id);
    const removed = error ? { error } : await supabase.from('package_items').delete().eq('package_id', pkg.id);
    const inserted = removed.error
      ? removed
      : await supabase.from('package_items').insert(
          items.map((l) => ({ package_id: pkg.id, service_id: l.serviceId, platform_id: l.platformId, quantity: l.quantity })),
        );
    setSaving(false);
    if (inserted.error) return setError(inserted.error.message);
    onDone();
  };

  return (
    <View style={local.form}>
      {LANGS.map((l) => (
        <Field
          key={`name-${l}`}
          label={`${t('services.name')} (${l})`}
          value={name[l] ?? ''}
          onChangeText={(v) => setName({ ...name, [l]: v })}
        />
      ))}
      {LANGS.map((l) => (
        <Field
          key={`desc-${l}`}
          label={`${t('packages.description')} (${l})`}
          multiline
          value={description[l] ?? ''}
          onChangeText={(v) => setDescription({ ...description, [l]: v })}
        />
      ))}
      <Text style={local.label}>{t('packages.items')}</Text>
      {lines.map((l) => {
        const service = catalog.services.find((s) => s.id === l.serviceId);
        const platform = catalog.platforms.find((p) => p.id === l.platformId);
        if (!service || (l.platformId && !platform)) return null;
        return (
          <View key={key(l.platformId, l.serviceId)} style={local.item}>
            <Text style={local.itemText}>
              {platform ? `${platform.name} · ` : ''}
              {serviceLabel(l.serviceId, service.name, l.platformId, language)}
            </Text>
            <Stepper
              value={quantities[key(l.platformId, l.serviceId)] ?? 0}
              onChange={(v) => setQuantities({ ...quantities, [key(l.platformId, l.serviceId)]: v })}
            />
          </View>
        );
      })}
      <Text style={styles.muted}>{t('packages.catalog', { amount: formatAmd(full, language) })}</Text>
      <Field
        label={t('packages.price')}
        keyboardType="number-pad"
        value={price}
        onChangeText={(v) => setPrice(v.replace(/\D/g, ''))}
      />
      <Choice
        value={active}
        onChange={setActive}
        options={[
          { value: 'yes', label: t('packages.visible') },
          { value: 'no', label: t('packages.hidden') },
        ]}
      />
      <ErrorText>{error}</ErrorText>
      <Button title={t('common.save')} onPress={save} loading={saving} />
      <Button title={t('common.cancel')} variant="ghost" onPress={onDone} />
    </View>
  );
}

const local = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  texts: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  edit: { fontSize: 15, fontWeight: '600', color: colors.primary },
  form: { gap: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  label: { fontSize: 15, fontWeight: '600', color: colors.text },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemText: { flex: 1, fontSize: 15, color: colors.text },
});
