import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from './theme';

export function Stepper({
  value,
  onChange,
  max = 100,
}: {
  value: number;
  onChange: (value: number) => void;
  max?: number;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="−"
        onPress={() => onChange(Math.max(0, value - 1))}
        style={styles.button}>
        <Text style={styles.sign}>−</Text>
      </Pressable>
      <Text style={styles.value}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="+"
        onPress={() => onChange(Math.min(max, value + 1))}
        style={styles.button}>
        <Text style={styles.sign}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  sign: { fontSize: 20, color: colors.primary, fontWeight: '600' },
  value: { minWidth: 28, textAlign: 'center', fontSize: 17, fontWeight: '600', color: colors.text },
});
