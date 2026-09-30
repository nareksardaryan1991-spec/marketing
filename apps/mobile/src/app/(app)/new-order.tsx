import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Choice } from '@/components/Choice';
import { Screen } from '@/components/Screen';
import { Stepper } from '@/components/Stepper';
import { colors } from '@/components/theme';
import { Button, Card, ErrorText, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmd, localized } from '@/lib/format';
import { serviceLabel } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import type { BillingType, Platform, PlatformService, PublishingMode, Service } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

const ADS_SERVICE_ID = 'ads_management';

// Ключ позиции заказа: «instagram:post» или «:video_shoot» для общей услуги.
const key = (platformId: string | null, serviceId: string) => `${platformId ?? ''}:${serviceId}`;

type Catalog = { platforms: Platform[]; offers: PlatformService[]; services: Service[] };

export default function NewOrderScreen() {
  const { t, language } = useI18n();
  const { business } = useAuth();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [adBudget, setAdBudget] = useState('');
  const [billing, setBilling] = useState<BillingType>('one_time');
  const [publishing, setPublishing] = useState<PublishingMode>('team');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from('platforms').select('*').eq('active', true).order('sort_order'),
      supabase.from('platform_services').select('*').eq('active', true),
      supabase.from('services').select('*').eq('active', true).order('sort_order'),
    ]).then(([platforms, offers, services]) => {
      setError(platforms.error?.message ?? offers.error?.message ?? services.error?.message ?? null);
      setCatalog({
        platforms: (platforms.data as Platform[] | null) ?? [],
        offers: (offers.data as PlatformService[] | null) ?? [],
        services: (services.data as Service[] | null) ?? [],
      });
    });
  }, []);

  const serviceById = useMemo(
    () => new Map((catalog?.services ?? []).map((s) => [s.id, s])),
    [catalog],
  );

  // Строки заказа: услуги выбранных площадок + общие услуги.
  const lines = useMemo(() => {
    if (!catalog) return [];
    const platformLines = catalog.offers
      .filter((o) => selected.includes(o.platform_id) && serviceById.has(o.service_id))
      .map((o) => ({ platformId: o.platform_id, serviceId: o.service_id, price: o.price_amd }));
    const generalLines = catalog.services
      .filter((s) => !s.per_platform)
      .map((s) => ({ platformId: null as string | null, serviceId: s.id, price: s.price_amd }));
    return [...platformLines, ...generalLines].map((line) => ({
      ...line,
      quantity: quantities[key(line.platformId, line.serviceId)] ?? 0,
    }));
  }, [catalog, selected, quantities, serviceById]);

  const withAds = (quantities[key(null, ADS_SERVICE_ID)] ?? 0) > 0;
  const adBudgetAmd = withAds ? Number(adBudget.replace(/\D/g, '')) || 0 : 0;

  // Предварительный расчёт; окончательную сумму считает сервер по тем же ценам.
  const subtotal = (platformId: string | null) =>
    lines
      .filter((l) => l.platformId === platformId)
      .reduce((sum, l) => sum + l.quantity * l.price, 0);
  const itemsTotal = lines.reduce((sum, l) => sum + l.quantity * l.price, 0);
  const total = itemsTotal + adBudgetAmd;

  const togglePlatform = (platformId: string) =>
    setSelected((prev) =>
      prev.includes(platformId) ? prev.filter((p) => p !== platformId) : [...prev, platformId],
    );

  const setQuantity = (platformId: string | null, serviceId: string, value: number) =>
    setQuantities((prev) => ({ ...prev, [key(platformId, serviceId)]: value }));

  const submit = async () => {
    if (!business) return;
    const items = lines
      .filter((l) => l.quantity > 0)
      .map((l) => ({ service_id: l.serviceId, platform_id: l.platformId, quantity: l.quantity }));
    if (items.length === 0) {
      setError(t('order.emptyOrder'));
      return;
    }
    setError(null);
    setSaving(true);
    const { data, error } = await supabase.rpc('create_order', {
      p_business_id: business.id,
      p_items: items,
      p_billing: billing,
      p_publishing: publishing,
      p_ad_budget_amd: adBudgetAmd,
      p_notes: notes,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace(`/orders/${data as string}`);
  };

  if (!catalog) {
    return (
      <View style={styles.center}>
        {error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const serviceRow = (platformId: string | null, serviceId: string, price: number) => {
    const service = serviceById.get(serviceId);
    if (!service) return null;
    return (
      <View key={key(platformId, serviceId)} style={styles.serviceRow}>
        <View style={styles.serviceText}>
          <Text style={styles.serviceName}>
            {serviceLabel(serviceId, service.name, platformId, language)}
          </Text>
          {localized(service.description, language) ? (
            <Text style={styles.muted}>{localized(service.description, language)}</Text>
          ) : null}
          <Text style={styles.price}>
            {formatAmd(price, language)} {t('order.perUnit')}
          </Text>
        </View>
        <Stepper
          value={quantities[key(platformId, serviceId)] ?? 0}
          onChange={(value) => setQuantity(platformId, serviceId, value)}
        />
      </View>
    );
  };

  return (
    <Screen>
      <Text style={styles.section}>{t('order.platformsTitle')}</Text>
      <Text style={styles.muted}>{t('order.platformsHint')}</Text>
      <View style={styles.chips}>
        {catalog.platforms.map((p) => {
          const active = selected.includes(p.id);
          return (
            <Pressable
              key={p.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              onPress={() => togglePlatform(p.id)}
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {active ? '✓ ' : ''}
                {p.name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {catalog.platforms
        .filter((p) => selected.includes(p.id))
        .map((p) => (
          <Card key={p.id}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{p.name}</Text>
              <Text style={styles.muted}>{formatAmd(subtotal(p.id), language)}</Text>
            </View>
            {catalog.offers
              .filter((o) => o.platform_id === p.id)
              .sort(
                (a, b) =>
                  (serviceById.get(a.service_id)?.sort_order ?? 0) -
                  (serviceById.get(b.service_id)?.sort_order ?? 0),
              )
              .map((o) => serviceRow(p.id, o.service_id, o.price_amd))}
          </Card>
        ))}

      <Text style={styles.section}>{t('order.extraServices')}</Text>
      <Card>
        {catalog.services
          .filter((s) => !s.per_platform)
          .map((s) => serviceRow(null, s.id, s.price_amd))}
      </Card>

      {withAds && (
        <Field
          label={t('order.adBudget')}
          hint={t('order.adBudgetHint')}
          keyboardType="number-pad"
          value={adBudget}
          onChangeText={setAdBudget}
        />
      )}

      <Text style={styles.section}>{t('order.billing')}</Text>
      <Choice
        value={billing}
        onChange={setBilling}
        options={[
          { value: 'one_time', label: t('order.oneTime') },
          { value: 'monthly', label: t('order.monthly'), hint: t('order.monthlyHint') },
        ]}
      />

      <Text style={styles.section}>{t('order.publishing')}</Text>
      <Choice
        value={publishing}
        onChange={setPublishing}
        options={[
          { value: 'team', label: t('order.publishTeam') },
          { value: 'auto', label: t('order.publishAuto'), hint: t('social.autoHint') },
          { value: 'client', label: t('order.publishClient') },
        ]}
      />

      <Field label={t('order.notes')} multiline value={notes} onChangeText={setNotes} />

      <Card>
        {catalog.platforms
          .filter((p) => selected.includes(p.id) && subtotal(p.id) > 0)
          .map((p) => (
            <View key={p.id} style={styles.totalRow}>
              <Text style={styles.muted}>{p.name}</Text>
              <Text style={styles.muted}>{formatAmd(subtotal(p.id), language)}</Text>
            </View>
          ))}
        {subtotal(null) > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.muted}>{t('order.extraServices')}</Text>
            <Text style={styles.muted}>{formatAmd(subtotal(null), language)}</Text>
          </View>
        )}
        {withAds && (
          <View style={styles.totalRow}>
            <Text style={styles.muted}>{t('order.adBudget')}</Text>
            <Text style={styles.muted}>{formatAmd(adBudgetAmd, language)}</Text>
          </View>
        )}
        <View style={styles.totalRow}>
          <Text style={styles.total}>{t('order.total')}</Text>
          <Text style={styles.total}>
            {formatAmd(total, language)}
            {billing === 'monthly' ? ` ${t('order.perMonth')}` : ''}
          </Text>
        </View>
      </Card>

      <ErrorText>{error}</ErrorText>
      <Button title={t('order.toPayment')} onPress={submit} loading={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  section: { fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 15, fontWeight: '500', color: colors.text },
  chipTextActive: { color: colors.primaryText },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cardTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  serviceText: { flex: 1, gap: 2 },
  serviceName: { fontSize: 16, fontWeight: '600', color: colors.text },
  price: { fontSize: 15, color: colors.primary, fontWeight: '500' },
  muted: { fontSize: 14, color: colors.muted },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  total: { fontSize: 18, fontWeight: '700', color: colors.text },
});
