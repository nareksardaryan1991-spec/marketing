import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { useI18n } from '@/i18n';
import {
  attachmentLabel,
  groupEventText,
  isOnline,
  listTime,
  type ChatListItem,
} from '@/lib/chat';
import { formatDate } from '@/lib/format';
import type { Language } from '@/lib/types';

import { chatColors } from './chatTheme';

export function chatTitle(
  item: ChatListItem,
  isClient: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
  language: Language,
) {
  if (item.chat === 'team') return item.kind === 'team' ? t('teamChat.general') : (item.title ?? '—');
  const date = item.order_created_at ? formatDate(item.order_created_at, language) : '';
  return isClient ? t('chats.orderChat', { date }) : `${item.title ?? ''} · ${date}`;
}

// Строка списка чатов: аватар (с зелёной точкой «в сети»), название, последнее сообщение,
// время, галочки у своего сообщения и счётчик непрочитанных.
export function ChatRow({
  item,
  myId,
  isClient,
  selected,
  compact,
  onPress,
}: {
  item: ChatListItem;
  myId: string | undefined;
  isClient: boolean;
  selected?: boolean;
  compact?: boolean;
  onPress: () => void;
}) {
  const { t, language } = useI18n();
  const title = chatTitle(item, isClient, t, language);
  const mine = !!item.last_author_id && item.last_author_id === myId;
  const read = mine && !!item.others_read_at && !!item.last_message_at && item.others_read_at >= item.last_message_at;
  const group = item.kind === 'team' || item.kind === 'group' || (item.chat === 'order' && !isClient);
  // Служебная строка группы — уже с именем, без «Автор:» впереди.
  const author = item.last_event ? null : mine ? t('chats.you') : group ? item.last_author : null;
  const preview = item.last_event
    ? groupEventText(item.last_event, item.last_author ?? '', t)
    : item.last_deleted
      ? t('chats.deleted')
      : item.last_body || attachmentLabel(item.last_attachment, t);
  const avatarName = item.kind === 'team' || (item.kind === 'group' && !item.avatar_path) ? '👥' : isClient ? t('chats.agency') : title;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}>
      <View>
        <Avatar name={avatarName} path={item.avatar_path} size={compact ? 40 : 50} />
        {item.kind !== 'team' && item.kind !== 'group' && isOnline(item.last_seen_at) && <View style={styles.onlineDot} />}
      </View>
      <View style={styles.text}>
        <View style={styles.line}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {!compact && item.last_message_at && (
            <Text style={[styles.time, item.unread > 0 && styles.timeUnread]}>
              {mine && <Text style={[styles.ticks, read && styles.ticksRead]}>{read ? '✓✓ ' : '✓ '}</Text>}
              {listTime(item.last_message_at, language)}
            </Text>
          )}
        </View>
        {!compact && (
          <View style={styles.line}>
            <Text style={styles.preview} numberOfLines={1}>
              {item.last_message_at ? (
                <>
                  {author ? <Text style={styles.author}>{author}: </Text> : null}
                  {preview}
                </>
              ) : (
                t('teamChat.noMessages')
              )}
            </Text>
            {item.unread > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.unread}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
  selected: { backgroundColor: '#E3EFFD' },
  pressed: { backgroundColor: '#F1F3F7' },
  onlineDot: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  text: { flex: 1, minWidth: 0, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: '600', color: chatColors.text },
  time: { fontSize: 12, color: chatColors.meta },
  timeUnread: { color: chatColors.accent },
  ticks: { color: chatColors.metaMine, fontWeight: '700' },
  ticksRead: { color: chatColors.read },
  preview: { flex: 1, fontSize: 14, color: chatColors.meta },
  author: { color: chatColors.text },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: chatColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
