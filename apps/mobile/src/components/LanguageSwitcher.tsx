import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LANGUAGES, useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import type { Language } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

import { colors } from './theme';

export function LanguageSwitcher() {
  const { language, setLanguage } = useI18n();
  const { session } = useAuth();

  const choose = (code: Language) => {
    setLanguage(code);
    if (session) {
      supabase.from('profiles').update({ language: code }).eq('id', session.user.id).then();
    }
  };

  return (
    <View style={styles.row}>
      {LANGUAGES.map(({ code, label }) => {
        const active = code === language;
        return (
          <Pressable
            key={code}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => choose(code)}
            style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextActive: { color: colors.primaryText, fontWeight: '600' },
});
