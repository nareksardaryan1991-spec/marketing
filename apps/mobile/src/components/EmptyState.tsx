import { StyleSheet, Text, View } from 'react-native';

import { colors } from './theme';
import { Button } from './ui';

// Вместо пустого «пока нет»: что здесь появится и что сделать прямо сейчас.
export function EmptyState({
  icon,
  text,
  action,
  onAction,
}: {
  icon?: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.box}>
      {icon ? <Text style={styles.icon}>{icon}</Text> : null}
      <Text style={styles.text}>{text}</Text>
      {action && onAction ? <Button title={action} variant="ghost" onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  icon: { fontSize: 28 },
  text: { fontSize: 15, lineHeight: 21, color: colors.muted, textAlign: 'center' },
});
