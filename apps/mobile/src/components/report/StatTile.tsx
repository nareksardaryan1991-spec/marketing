import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';
import { chart } from './chartTokens';

// Плитка показателя: подпись, значение, изменение (знак + стрелка, не только цвет).
export function StatTile({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: { text: string; direction: 'up' | 'down' | 'flat' };
}) {
  return (
    <View style={styles.tile}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {delta && (
        <Text
          style={[
            styles.delta,
            delta.direction === 'up' && { color: chart.up },
            delta.direction === 'down' && { color: chart.down },
          ]}>
          {delta.direction === 'up' ? '▲ ' : delta.direction === 'down' ? '▼ ' : ''}
          {delta.text}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    padding: 14,
    gap: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  label: { fontSize: 13, color: colors.muted },
  value: { fontSize: 26, fontWeight: '600', color: colors.text },
  delta: { fontSize: 13, color: colors.muted },
});
