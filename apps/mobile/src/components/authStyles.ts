import { StyleSheet } from 'react-native';

import { colors, fonts } from './theme';

export const authStyles = StyleSheet.create({
  title: { fontSize: 28, fontFamily: fonts.display, color: colors.text, marginTop: 24 },
  subtitle: { fontSize: 16, color: colors.muted },
  link: { color: colors.primary, fontSize: 15, textAlign: 'center', padding: 8 },
  info: { fontSize: 15, color: colors.text },
});
