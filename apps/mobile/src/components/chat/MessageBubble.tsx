import { memo, useMemo, useState } from 'react';
import {
  Animated,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useI18n } from '@/i18n';
import {
  messagePreview,
  timeOf,
  type Attachment,
  type ChatMessage,
  type DeletedOriginal,
} from '@/lib/chat';

import { Attachments } from './Attachments';
import { CallCard } from './CallCard';
import { chatColors } from './chatTheme';

export type ReactionGroup = { emoji: string; count: number; mine: boolean; names: string[] };

const URL_RE = /(https?:\/\/[^\s]+)/g;
const SWIPE_REPLY = 60;

// Ссылки в тексте — нажимаемые.
function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={styles.link} onPress={() => Linking.openURL(part)}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  );
}

type Props = {
  message: ChatMessage;
  mine: boolean;
  showAuthor: boolean;
  authorLabel: string;
  authorColor: string;
  replyTo: ChatMessage | undefined;
  replyAuthor: string;
  reactions: ReactionGroup[];
  read: boolean;
  original: DeletedOriginal | undefined;
  urls: Record<string, string>;
  highlighted: boolean;
  onMenu: (message: ChatMessage) => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  onOpenPhoto: (photos: Attachment[], index: number) => void;
  onJumpTo: (id: string) => void;
  onSwipeReply: (message: ChatMessage) => void;
  onJoinCall: (call: NonNullable<ChatMessage['call']>) => void;
};

export const MessageBubble = memo(function MessageBubble({
  message,
  mine,
  showAuthor,
  authorLabel,
  authorColor,
  replyTo,
  replyAuthor,
  reactions,
  read,
  original,
  urls,
  highlighted,
  onMenu,
  onReact,
  onOpenPhoto,
  onJumpTo,
  onSwipeReply,
  onJoinCall,
}: Props) {
  const { t, language } = useI18n();
  const deleted = !!message.deleted_at;
  // Удалённое владелец видит бледным, с пометкой.
  const shown = deleted && original ? { ...message, body: original.body, attachments: original.attachments } : message;
  const mediaOnly =
    !deleted &&
    !shown.body &&
    !shown.forwarded_from &&
    !shown.reply_to_id &&
    shown.attachments.length > 0 &&
    shown.attachments.every((a) => a.kind === 'photo');

  const meta = `${message.edited_at ? `${t('chats.edited')} ` : ''}${timeOf(message.created_at, language)}`;
  const ticks = mine && !deleted ? (read ? ' ✓✓' : ' ✓') : '';

  // Свайп вправо на телефоне — «Ответить».
  const [shift] = useState(() => new Animated.Value(0));
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dx > 12 && Math.abs(g.dy) < 10,
        onPanResponderMove: (_, g) => shift.setValue(Math.max(0, Math.min(g.dx, 90))),
        onPanResponderRelease: (_, g) => {
          if (g.dx > SWIPE_REPLY) onSwipeReply(message);
          Animated.spring(shift, { toValue: 0, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () => Animated.spring(shift, { toValue: 0, useNativeDriver: true }).start(),
      }),
    [shift, message, onSwipeReply],
  );

  // В браузере меню открывается и правой кнопкой мыши.
  const webMenu =
    Platform.OS === 'web'
      ? ({
          onContextMenu: (e: { preventDefault: () => void }) => {
            e.preventDefault();
            onMenu(message);
          },
        } as object)
      : {};

  return (
    <Animated.View
      {...(Platform.OS === 'web' ? {} : pan.panHandlers)}
      style={[styles.row, mine && styles.rowMine, highlighted && styles.highlighted, { transform: [{ translateX: shift }] }]}>
      <Pressable
        onLongPress={() => onMenu(message)}
        delayLongPress={350}
        {...webMenu}
        style={[
          styles.bubble,
          mine ? styles.mine : styles.theirs,
          mediaOnly && styles.mediaBubble,
          deleted && !original && styles.deletedBubble,
        ]}>
        {showAuthor && <Text style={[styles.author, { color: authorColor }]}>{authorLabel}</Text>}

        {deleted && (
          <Text style={styles.deleted}>
            🚫 {t('chats.deleted')}
            {original ? ` · ${t('chats.deletedOriginal')}` : ''}
          </Text>
        )}

        <View style={deleted && styles.faded}>
          {shown.forwarded_from && (
            <Text style={styles.forwarded}>{t('chats.forwardedFrom', { name: shown.forwarded_from })}</Text>
          )}

          {message.reply_to_id && (
            <Pressable
              accessibilityRole="button"
              onPress={() => onJumpTo(message.reply_to_id!)}
              style={[styles.quote, mine && styles.quoteMine]}>
              <Text style={styles.quoteAuthor} numberOfLines={1}>
                {replyTo ? replyAuthor : '…'}
              </Text>
              <Text style={styles.quoteText} numberOfLines={1}>
                {messagePreview(replyTo ?? null, t)}
              </Text>
            </Pressable>
          )}

          {message.call && !deleted && <CallCard call={message.call} mine={mine} onJoin={onJoinCall} />}

          {shown.attachments.length > 0 && (
            <View style={!mediaOnly && styles.attachmentsGap}>
              <Attachments attachments={shown.attachments} urls={urls} mine={mine} onOpenPhoto={onOpenPhoto} />
            </View>
          )}

          {!!shown.body && (
            <Text selectable style={styles.body}>
              <Linkified text={shown.body} />
              {/* Место под время справа, как в Telegram: невидимая копия подписи. */}
              <Text style={styles.metaSpacer}>
                {'  '}
                {meta}
                {ticks}
              </Text>
            </Text>
          )}
        </View>
        {/* Без текста место под время — отдельной строкой. */}
        {!shown.body && !mediaOnly && <View style={styles.metaLine} />}

        <View style={[styles.meta, mediaOnly && styles.metaOnMedia]}>
          <Text style={[styles.metaText, mine && styles.metaMine, mediaOnly && styles.metaTextOnMedia]}>
            {meta}
          </Text>
          {!!ticks && (
            <Text style={[styles.ticks, read && styles.ticksRead, mediaOnly && styles.metaTextOnMedia]}>
              {ticks}
            </Text>
          )}
        </View>
      </Pressable>

      {reactions.length > 0 && (
        <View style={[styles.reactions, mine && styles.reactionsMine]}>
          {reactions.map((r) => (
            <Pressable
              key={r.emoji}
              accessibilityRole="button"
              accessibilityLabel={r.names.join(', ')}
              onPress={() => onReact(message, r.emoji)}
              style={[styles.reaction, r.mine && styles.reactionMine]}>
              <Text style={[styles.reactionText, r.mine && styles.reactionTextMine]}>
                {r.emoji} {r.count > 1 ? r.count : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: { alignItems: 'flex-start', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 8 },
  rowMine: { alignItems: 'flex-end' },
  highlighted: { backgroundColor: chatColors.highlight },
  bubble: {
    maxWidth: '85%',
    minWidth: 70,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 6,
    borderRadius: 16,
    // Лёгкая тень, как у пузырей Telegram.
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  mine: { backgroundColor: chatColors.mine, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: chatColors.theirs, borderBottomLeftRadius: 4 },
  mediaBubble: { padding: 3 },
  deletedBubble: { opacity: 0.85 },
  faded: { opacity: 0.55 },
  author: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  deleted: { fontSize: 14, fontStyle: 'italic', color: chatColors.meta, marginBottom: 2 },
  forwarded: { fontSize: 13, fontWeight: '600', color: chatColors.accent, marginBottom: 3 },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: chatColors.accent,
    backgroundColor: 'rgba(47, 140, 240, 0.08)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 4,
  },
  quoteMine: { backgroundColor: 'rgba(47, 140, 240, 0.14)' },
  quoteAuthor: { fontSize: 13, fontWeight: '700', color: chatColors.accent },
  quoteText: { fontSize: 13, color: chatColors.text },
  attachmentsGap: { marginBottom: 4 },
  body: { fontSize: 15, lineHeight: 20, color: chatColors.text },
  link: { color: chatColors.link, textDecorationLine: 'underline' },
  metaSpacer: { fontSize: 11, color: 'transparent' },
  meta: { position: 'absolute', right: 8, bottom: 4, flexDirection: 'row', alignItems: 'center' },
  metaOnMedia: {
    right: 10,
    bottom: 10,
    backgroundColor: chatColors.pillBackground,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  metaText: { fontSize: 11, color: chatColors.meta },
  metaMine: { color: chatColors.metaMine },
  metaTextOnMedia: { color: chatColors.pillText },
  ticks: { fontSize: 11, color: chatColors.metaMine, fontWeight: '700' },
  ticksRead: { color: chatColors.read },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3, maxWidth: '85%' },
  reactionsMine: { justifyContent: 'flex-end' },
  reaction: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  reactionMine: { backgroundColor: chatColors.accent, borderColor: chatColors.accent },
  reactionText: { fontSize: 13, color: chatColors.text },
  reactionTextMine: { color: '#FFFFFF' },
  metaLine: { height: 14 },
});
