import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from './theme';

export function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.list}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            onPress={() => onChange(option.value)}
            style={[styles.option, active && styles.optionActive]}>
            <View style={[styles.dot, active && styles.dotActive]} />
            <View style={styles.texts}>
              <Text style={styles.label}>{option.label}</Text>
              {option.hint ? <Text style={styles.hint}>{option.hint}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// Несколько вариантов с галочками. locked — отмечено всегда, снять нельзя (подсказка lockedHint).
export function CheckList({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; hint?: string; locked?: boolean }[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <View style={styles.list}>
      {options.map((option) => {
        const checked = option.locked || value.includes(option.value);
        return (
          <Pressable
            key={option.value}
            accessibilityRole="checkbox"
            accessibilityState={{ checked, disabled: option.locked }}
            disabled={option.locked}
            onPress={() =>
              onChange(checked ? value.filter((v) => v !== option.value) : [...value, option.value])
            }
            style={[styles.option, checked && styles.optionActive, option.locked && styles.locked]}>
            <View style={[styles.box, checked && styles.dotActive]}>
              {checked && <Text style={styles.tick}>✓</Text>}
            </View>
            <View style={styles.texts}>
              <Text style={styles.label}>{option.label}</Text>
              {option.hint ? <Text style={styles.hint}>{option.hint}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionActive: { borderColor: colors.primary },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.border },
  dotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  box: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 15 },
  locked: { opacity: 0.6 },
  texts: { flex: 1, gap: 2 },
  label: { fontSize: 16, color: colors.text },
  hint: { fontSize: 13, color: colors.muted },
});
