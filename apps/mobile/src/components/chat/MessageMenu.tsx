import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { messagePreview, REACTIONS, type ChatMessage } from '@/lib/chat';

import { chatColors } from './chatTheme';

export type MenuAction = 'reply' | 'forward' | 'copy' | 'edit' | 'pin' | 'unpin' | 'delete';

// Меню по долгому нажатию (или правой кнопке мыши): реакции сверху, действия списком.
export function MessageMenu({
  message,
  canEdit,
  canDelete,
  isPinned,
  myReaction,
  onReact,
  onAction,
  onClose,
}: {
  message: ChatMessage | null;
  canEdit: boolean;
  canDelete: boolean;
  isPinned: boolean;
  myReaction: string | undefined;
  onReact: (emoji: string) => void;
  onAction: (action: MenuAction) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (!message) return null;
  const deleted = !!message.deleted_at;

  const actions: { key: MenuAction; icon: string; label: string; danger?: boolean }[] = deleted
    ? []
    : [
        { key: 'reply', icon: '↩️', label: t('chats.reply') },
        { key: 'forward', icon: '↪️', label: t('chats.forward') },
        ...(message.body ? [{ key: 'copy' as const, icon: '📋', label: t('chats.copy') }] : []),
        ...(canEdit ? [{ key: 'edit' as const, icon: '✏️', label: t('chats.edit') }] : []),
        isPinned
          ? { key: 'unpin' as const, icon: '📌', label: t('chats.unpin') }
          : { key: 'pin' as const, icon: '📌', label: t('chats.pin') },
        ...(canDelete ? [{ key: 'delete' as const, icon: '🗑', label: t('chats.delete'), danger: true }] : []),
      ];

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('chats.close')} style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          {!deleted && (
            <View style={styles.reactions}>
              {REACTIONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={emoji}
                  onPress={() => onReact(emoji)}
                  style={[styles.reaction, myReaction === emoji && styles.reactionActive]}>
                  <Text style={styles.reactionText}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Text style={styles.preview} numberOfLines={2}>
            {messagePreview(message, t)}
          </Text>
          {actions.map((action) => (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              onPress={() => onAction(action.key)}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}>
              <Text style={styles.actionIcon}>{action.icon}</Text>
              <Text style={[styles.actionText, action.danger && styles.danger]}>{action.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  reactions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E1E3EA',
  },
  reaction: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  reactionActive: { backgroundColor: chatColors.highlight },
  reactionText: { fontSize: 22 },
  preview: { fontSize: 13, color: chatColors.meta, paddingHorizontal: 16, paddingVertical: 8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 11 },
  actionPressed: { backgroundColor: '#F1F3F7' },
  actionIcon: { fontSize: 17, width: 22, textAlign: 'center' },
  actionText: { fontSize: 16, color: chatColors.text },
  danger: { color: '#DC2626' },
});
