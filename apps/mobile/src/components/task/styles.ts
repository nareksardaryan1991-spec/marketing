import { StyleSheet } from 'react-native';

import { colors } from '../theme';

export const taskStyles = StyleSheet.create({
  cardTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  text: { fontSize: 15, color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  label: { fontSize: 13, color: colors.muted, textTransform: 'uppercase' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
