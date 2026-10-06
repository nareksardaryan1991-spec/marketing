import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { localized } from '@/lib/format';
import { useMoney } from '@/lib/money';
import { serviceLabel } from '@/lib/platforms';
import type { Package, Platform, PlatformService, Service } from '@/lib/types';

import { colors } from './theme';

type Catalog = { platforms: Platform[]; offers: PlatformService[]; services: Service[] };

// Сколько те же услуги стоят по каталогу — чтобы показать выгоду пакета.
export function catalogPrice(pkg: Package, catalog: Catalog): number {
  return pkg.package_items.reduce((sum, item) => {
    const offer = catalog.offers.find((o) => o.platform_id === item.platform_id && o.service_id === item.service_id);
    const price = offer?.price_amd ?? catalog.services.find((s) => s.id === item.service_id)?.price_amd ?? 0;
    return sum + price * item.quantity;
  }, 0);
}

// Цена пакета для клиента: не дороже тех же услуг по каталогу (так же считает база).
export function packagePrice(pkg: Package, catalog: Catalog): number {
  const full = catalogPrice(pkg, catalog);
  return full > 0 ? Math.min(pkg.price_amd, full) : pkg.price_amd;
}

// Пакеты на месяц: состав, цена за месяц и выгода против заказа по отдельности.
export function PackagePicker({
  packages,
  catalog,
  selected,
  onSelect,
}: {
  packages: Package[];
  catalog: Catalog;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { t, language } = useI18n();
  const { money } = useMoney();

  return (
    <View style={styles.list}>
      {packages.map((pkg) => {
        const active = pkg.id === selected;
        const full = catalogPrice(pkg, catalog);
        const price = packagePrice(pkg, catalog);
        const saving = full > price ? Math.round(((full - price) / full) * 100) : 0;
        return (
          <Pressable
            key={pkg.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            onPress={() => onSelect(pkg.id)}
            style={[styles.card, active && styles.cardActive]}>
            <View style={styles.head}>
              <View style={[styles.dot, active && styles.dotActive]} />
              <Text style={styles.name}>{localized(pkg.name, language)}</Text>
              {saving > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>−{saving}%</Text>
                </View>
              )}
            </View>
            {localized(pkg.description, language) ? (
              <Text style={styles.muted}>{localized(pkg.description, language)}</Text>
            ) : null}
            {pkg.package_items.map((item) => {
              const service = catalog.services.find((s) => s.id === item.service_id);
              const platform = catalog.platforms.find((p) => p.id === item.platform_id);
              return (
                <Text key={`${item.platform_id}:${item.service_id}`} style={styles.item}>
                  • {platform ? `${platform.name} · ` : ''}
                  {service ? serviceLabel(item.service_id, service.name, item.platform_id, language) : item.service_id} ×{' '}
                  {item.quantity}
                </Text>
              );
            })}
            <View style={styles.priceRow}>
              <Text style={styles.price}>
                {money(price)} {t('order.perMonth')}
              </Text>
              {saving > 0 && <Text style={styles.old}>{money(full)}</Text>}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  card: {
    gap: 6,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardActive: { borderColor: colors.primary },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border },
  dotActive: { borderColor: colors.primary, borderWidth: 6 },
  name: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.text },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: '#DCFCE7' },
  badgeText: { fontSize: 13, fontWeight: '700', color: '#166534' },
  muted: { fontSize: 14, color: colors.muted },
  item: { fontSize: 15, color: colors.text },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  price: { fontSize: 17, fontWeight: '700', color: colors.text },
  old: { fontSize: 14, color: colors.muted, textDecorationLine: 'line-through' },
});
