import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useI18n } from '@/i18n';
import { BRAND_PRESETS, HEX_COLOR, logoUrl, MAX_BRAND_COLORS } from '@/lib/brand';

import { colors } from './theme';
import { Button } from './ui';

// Логотип и фирменные цвета бизнеса — их использует AI-дизайнер.
export function BrandFields({
  logoPath,
  brandColors,
  onPickLogo,
  onRemoveLogo,
  onChangeColors,
  uploading,
}: {
  logoPath: string | null;
  brandColors: string[];
  onPickLogo: () => void;
  onRemoveLogo: () => void;
  onChangeColors: (next: string[]) => void;
  uploading: boolean;
}) {
  const { t } = useI18n();
  const [custom, setCustom] = useState('');
  const url = logoUrl(logoPath);
  const full = brandColors.length >= MAX_BRAND_COLORS;
  const has = (c: string) => brandColors.some((x) => x.toLowerCase() === c.toLowerCase());

  const toggle = (color: string) => {
    if (has(color)) onChangeColors(brandColors.filter((x) => x.toLowerCase() !== color.toLowerCase()));
    else if (!full) onChangeColors([...brandColors, color.toUpperCase()]);
  };

  const customHex = (custom.startsWith('#') ? custom : `#${custom}`).trim();
  const customValid = HEX_COLOR.test(customHex);
  const addCustom = () => {
    if (!customValid || full || has(customHex)) return;
    onChangeColors([...brandColors, customHex.toUpperCase()]);
    setCustom('');
  };

  return (
    <>
      <Text style={styles.label}>{t('business.logo')}</Text>
      <View style={styles.logoRow}>
        <View style={styles.logoBox}>
          {url ? (
            <Image source={{ uri: url }} style={styles.logo} contentFit="contain" />
          ) : (
            <Text style={styles.muted}>{t('business.noLogo')}</Text>
          )}
        </View>
        <View style={styles.logoActions}>
          <Button
            title={url ? t('business.changeLogo') : t('business.uploadLogo')}
            variant="ghost"
            onPress={onPickLogo}
            loading={uploading}
          />
          {url && <Button title={t('business.removeLogo')} variant="ghost" onPress={onRemoveLogo} />}
        </View>
      </View>
      <Text style={styles.hint}>{t('business.logoHint')}</Text>

      <Text style={styles.label}>{t('business.colors')}</Text>
      <Text style={styles.hint}>{t('business.colorsHint', { max: MAX_BRAND_COLORS })}</Text>
      {brandColors.length > 0 && (
        <View style={styles.chosen}>
          {brandColors.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityLabel={t('business.removeColor', { color: c })}
              onPress={() => toggle(c)}
              style={styles.chip}>
              <View style={[styles.dot, { backgroundColor: c }]} />
              <Text style={styles.chipText}>{c}</Text>
              <Text style={styles.chipX}>×</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.presets}>
        {BRAND_PRESETS.map((c) => (
          <Pressable
            key={c}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: has(c), disabled: full && !has(c) }}
            accessibilityLabel={c}
            onPress={() => toggle(c)}
            style={[styles.swatch, { backgroundColor: c }, has(c) && styles.swatchOn, full && !has(c) && styles.swatchOff]}
          />
        ))}
      </View>
      <View style={styles.customRow}>
        <View style={[styles.preview, customValid && { backgroundColor: customHex }]} />
        <TextInput
          value={custom}
          onChangeText={setCustom}
          placeholder="#7A4B2A"
          placeholderTextColor={colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          style={styles.input}
          accessibilityLabel={t('business.customColor')}
        />
        <View style={styles.addButton}>
          <Button title={t('business.addColor')} variant="ghost" onPress={addCustom} />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 4 },
  hint: { fontSize: 13, color: colors.muted },
  muted: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoBox: {
    width: 96,
    height: 96,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  logo: { width: '100%', height: '100%' },
  logoActions: { flex: 1, gap: 4 },
  chosen: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  chipText: { fontSize: 14, color: colors.text, fontVariant: ['tabular-nums'] },
  chipX: { fontSize: 18, color: colors.muted },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  swatchOn: { borderWidth: 3, borderColor: colors.primary },
  swatchOff: { opacity: 0.35 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  addButton: { flexShrink: 0 },
  preview: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
});
