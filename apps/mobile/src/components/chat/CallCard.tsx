import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import type { ChatMessage } from '@/lib/chat';

import { chatColors } from './chatTheme';

// Сообщение-звонок: вид звонка и кнопка «Присоединиться» (у обоих собеседников).
export function CallCard({
  call,
  mine,
  onJoin,
}: {
  call: NonNullable<ChatMessage['call']>;
  mine: boolean;
  onJoin: (call: NonNullable<ChatMessage['call']>) => void;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.card}>
      <View style={[styles.icon, mine && styles.iconMine]}>
        <Text style={styles.iconText}>{call.video ? '🎥' : '📞'}</Text>
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{call.video ? t('chats.videoCall') : t('chats.audioCall')}</Text>
        <Pressable accessibilityRole="button" onPress={() => onJoin(call)} style={styles.join}>
          <Text style={styles.joinText}>{t('chats.join')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 210, paddingVertical: 2 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E3EFFD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconMine: { backgroundColor: '#FFFFFF' },
  iconText: { fontSize: 20 },
  text: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: '700', color: chatColors.text },
  join: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#22C55E',
  },
  joinText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
