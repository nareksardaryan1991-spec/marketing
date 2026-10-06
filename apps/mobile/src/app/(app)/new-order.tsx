import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Choice } from '@/components/Choice';
import { PackagePicker, packagePrice } from '@/components/PackagePicker';
import { Screen } from '@/components/Screen';
import { Stepper } from '@/components/Stepper';
import { colors } from '@/components/theme';
import { Button, Card, ErrorText, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { localized } from '@/lib/format';
import { useMoney } from '@/lib/money';
import { promoDiscount, promoErrorKey, type AppliedPromo } from '@/lib/promo';
import { serviceLabel } from '@/lib/platforms';
import { supabase } from '@/lib/supabase';
import type { BillingType, Package, Platform, PlatformService, PublishingMode, Service } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

const ADS_SERVICE_ID = 'ads_management';

// Ключ позиции заказа: «instagram:post» или «:video_shoot» для общей услуги.
const key = (platformId: string | null, serviceId: string) => `${platformId ?? ''}:${serviceId}`;

type Catalog = { platforms: Platform[]; offers: PlatformService[]; services: Service[] };

export default function NewOrderScreen() {
  const { t, language } = useI18n();
  const { money, moneyToPay, currency } = useMoney();
  const { business } = useAuth();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [adBudget, setAdBudget] = useState('');
  const [billing, setBilling] = useState<BillingType>('one_time');
  const [publishing, setPublishing] = useState<PublishingMode>('team');
  const [notes, setNotes] = useState('');
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<AppliedPromo | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [checkingPromo, setCheckingPromo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [packages, setPackages] = useState<Package[]>([]);
  const [mode, setMode] = useState<'package' | 'custom'>('custom');
  const [packageId, setPackageId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from('platforms').select('*').eq('active', true).order('sort_order'),
      supabase.from('platform_services').select('*').eq('active', true),
      supabase.from('services').select('*').eq('active', true).order('sort_order'),
      supabase.from('packages').select('*, package_items(*)').eq('active', true).order('sort_order'),
    ]).then(([platforms, offers, services, packageRows]) => {
      const list = (packageRows.data as Package[] | null) ?? [];
      setPackages(list);
      // Есть пакеты — начинаем с них: так проще всего начать.
      if (list.length) {
        setMode('package');
        setPackageId(list[0].id);
      }
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
  const discount = promoDiscount(promo, itemsTotal);
  const total = itemsTotal - discount + adBudgetAmd;

  const applyPromo = async () => {
    if (!promoInput.trim()) return;
    setCheckingPromo(true);
    const { data, error } = await supabase.rpc('check_promo', { p_code: promoInput });
    setCheckingPromo(false);
    if (error) {
      const key = promoErrorKey(error.message);
      setPromoError(key ? t(key) : error.message);
      setPromo(null);
      return;
    }
    setPromoError(null);
    setPromo(data as AppliedPromo);
  };

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
      p_promo_code: promo?.code ?? null,
    });
    setSaving(false);
    if (error) {
      const promoKey = promoErrorKey(error.message);
      setError(promoKey ? t(promoKey) : error.message);
      return;
    }
    router.replace(`/orders/${data as string}`);
  };

  const submitPackage = async () => {
    if (!business || !packageId) return;
    setError(null);
    setSaving(true);
    const { data, error } = await supabase.rpc('create_package_order', {
      p_business_id: business.id,
      p_package_id: packageId,
      p_publishing: publishing,
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
            {money(price)} {t('order.perUnit')}
          </Text>
        </View>
        <Stepper
          value={quantities[key(platformId, serviceId)] ?? 0}
          onChange={(value) => setQuantity(platformId, serviceId, value)}
        />
      </View>
    );
  };

  const chosen = packages.find((p) => p.id === packageId) ?? null;

  return (
    <Screen>
      {packages.length > 0 && (
        <View style={styles.modes} accessibilityRole="tablist">
          {(['package', 'custom'] as const).map((m) => (
            <Pressable
              key={m}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === m }}
              onPress={() => setMode(m)}
              style={[styles.mode, mode === m && styles.modeActive]}>
              <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
                {m === 'package' ? t('packages.monthly') : t('packages.custom')}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {mode === 'package' && (
        <>
          <Text style={styles.muted}>{t('packages.hint')}</Text>
          <PackagePicker packages={packages} catalog={catalog} selected={packageId} onSelect={setPackageId} />
        </>
      )}

      {mode === 'custom' && (
        <>
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
                  <Text style={styles.muted}>{money(subtotal(p.id))}</Text>
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

        </>
      )}

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

      {mode === 'package' && chosen && (
        <Card>
          <View style={styles.totalRow}>
            <Text style={styles.total}>{t('order.total')}</Text>
            <Text style={styles.total}>
              {moneyToPay(packagePrice(chosen, catalog))} {t('order.perMonth')}
            </Text>
          </View>
          {currency !== 'AMD' && <Text style={styles.muted}>{t('money.payInAmd')}</Text>}
          <Text style={styles.muted}>{t('packages.renewHint')}</Text>
        </Card>
      )}

      {mode === 'custom' && (
        <>
          <Card>
            {promo ? (
              <View style={styles.totalRow}>
                <Text style={styles.promoOk}>
                  🎟 {promo.code} ·{' '}
                  {t('promo.applied', {
                    value: promo.percent ? `${promo.percent}%` : money(promo.amount_amd ?? 0),
                  })}
                </Text>
                <Text
                  style={styles.link}
                  onPress={() => {
                    setPromo(null);
                    setPromoInput('');
                  }}>
                  {t('promo.remove')}
                </Text>
              </View>
            ) : (
              <>
                <Field
                  label={t('promo.field')}
                  hint="AUTUMN10"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  value={promoInput}
                  onChangeText={(v) => {
                    setPromoInput(v);
                    setPromoError(null);
                  }}
                />
                <ErrorText>{promoError}</ErrorText>
                <Button
                  title={t('promo.apply')}
                  variant="ghost"
                  onPress={applyPromo}
                  loading={checkingPromo}
                />
              </>
            )}
          </Card>

          <Card>
            {catalog.platforms
              .filter((p) => selected.includes(p.id) && subtotal(p.id) > 0)
              .map((p) => (
                <View key={p.id} style={styles.totalRow}>
                  <Text style={styles.muted}>{p.name}</Text>
                  <Text style={styles.muted}>{money(subtotal(p.id))}</Text>
                </View>
              ))}
            {subtotal(null) > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.muted}>{t('order.extraServices')}</Text>
                <Text style={styles.muted}>{money(subtotal(null))}</Text>
              </View>
            )}
            {withAds && (
              <View style={styles.totalRow}>
                <Text style={styles.muted}>{t('order.adBudget')}</Text>
                <Text style={styles.muted}>{money(adBudgetAmd)}</Text>
              </View>
            )}
            {discount > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.promoOk}>{t('promo.discount')}</Text>
                <Text style={styles.promoOk}>−{money(discount)}</Text>
              </View>
            )}
            <View style={styles.totalRow}>
              <Text style={styles.total}>{t('order.total')}</Text>
              <Text style={styles.total}>
                {moneyToPay(total)}
                {billing === 'monthly' ? ` ${t('order.perMonth')}` : ''}
              </Text>
            </View>
            {currency !== 'AMD' && <Text style={styles.muted}>{t('money.payInAmd')}</Text>}
            {discount > 0 && billing === 'monthly' && (
              <Text style={styles.muted}>{t('promo.firstMonthOnly')}</Text>
            )}
          </Card>

        </>
      )}

      <ErrorText>{error}</ErrorText>
      <Button
        title={t('order.toPayment')}
        onPress={mode === 'package' ? submitPackage : submit}
        loading={saving}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  section: { fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 8 },
  modes: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: 14,
    backgroundColor: colors.border,
  },
  mode: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingHorizontal: 8 },
  modeActive: { backgroundColor: colors.surface },
  modeText: { fontSize: 15, color: colors.muted, textAlign: 'center' },
  modeTextActive: { color: colors.text, fontWeight: '600' },
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
  promoOk: { fontSize: 15, fontWeight: '600', color: '#047857' },
  link: { fontSize: 15, color: colors.primary },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  total: { fontSize: 18, fontWeight: '700', color: colors.text },
});
