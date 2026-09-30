import { useRef, useState, type ReactNode } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useI18n } from '@/i18n';
import type { ChatMessage } from '@/lib/useChatMessages';

import { colors } from './theme';
import { ErrorText } from './ui';

const LOCALES = { ru: 'ru-RU', hy: 'hy-AM', en: 'en-US' } as const;
// Шире этого экран считается монитором: чат становится окном по центру.
const WIDE_SCREEN = 700;

// Лента сообщений и поле ввода. Данные и отправку даёт экран.
export function ChatView({
  messages,
  myId,
  authorLabel,
  onSend,
  error,
  draft,
  onDraftChange,
  extraAction,
}: {
  messages: ChatMessage[];
  myId: string | undefined;
  authorLabel: (message: ChatMessage) => string;
  onSend: (body: string) => Promise<string | null>;
  error: string | null;
  draft: string;
  onDraftChange: (text: string) => void;
  extraAction?: ReactNode;
}) {
  const { t, language } = useI18n();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const wide = useWindowDimensions().width >= WIDE_SCREEN;

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSendError(null);
    setSending(true);
    const failure = await onSend(body);
    setSending(false);
    if (failure) setSendError(failure);
    else onDraftChange('');
  };

  // На компьютере Enter отправляет, Shift+Enter — новая строка. На телефоне Enter — перенос,
  // отправка кнопкой. isComposing — ввод через IME ещё не закончен.
  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const event = e.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean };
    if (Platform.OS !== 'web' || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    e.preventDefault();
    if (!sending) send();
  };

  const time = (iso: string) =>
    new Date(iso).toLocaleString(LOCALES[language], {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <SafeAreaView style={[styles.safe, wide && styles.safeWide]} edges={['bottom']}>
      <KeyboardAvoidingView
        style={[styles.window, wide && styles.windowWide]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          style={styles.flex}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Text style={styles.empty}>{t('chat.empty')}</Text>}
          renderItem={({ item, index }) => {
            const mine = item.author_id === myId;
            // Имя — один раз над серией сообщений одного автора.
            const firstInGroup = messages[index - 1]?.author_id !== item.author_id;
            return (
              <View
                style={[
                  styles.bubble,
                  mine ? styles.mine : styles.theirs,
                  firstInGroup && styles.groupStart,
                ]}>
                {!mine && firstInGroup && <Text style={styles.author}>{authorLabel(item)}</Text>}
                <Text selectable style={[styles.body, mine && styles.bodyMine]}>
                  {item.body}
                </Text>
                <Text style={[styles.time, mine && styles.timeMine]}>{time(item.created_at)}</Text>
              </View>
            );
          }}
        />
        <View style={styles.composer}>
          <ErrorText>{error ?? sendError}</ErrorText>
          {extraAction}
          <View style={styles.inputRow}>
            <TextInput
              value={draft}
              onChangeText={onDraftChange}
              onKeyPress={onKeyPress}
              placeholder={t('chat.placeholder')}
              placeholderTextColor={colors.muted}
              multiline
              // В браузере многострочное поле по умолчанию в две строки — делаем одну.
              numberOfLines={1}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('task.send')}
              onPress={send}
              disabled={sending || !draft.trim()}
              style={[styles.send, (sending || !draft.trim()) && styles.sendDisabled]}>
              <Text style={styles.sendIcon}>➤</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const CHAT_BACKGROUND = '#EEF0F7';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  safeWide: { paddingVertical: 16, paddingHorizontal: 16 },
  flex: { flex: 1 },
  // Окно чата: на телефоне во весь экран, на мониторе — колонка по центру.
  window: { flex: 1, width: '100%', alignSelf: 'center', backgroundColor: CHAT_BACKGROUND },
  windowWide: {
    maxWidth: 560,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  list: { paddingHorizontal: 12, paddingVertical: 12, gap: 2, flexGrow: 1 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 32, fontSize: 14 },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 4,
    borderRadius: 16,
  },
  groupStart: { marginTop: 6 },
  // «Хвостик» — меньшее скругление в углу со стороны автора.
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
  },
  author: { fontSize: 12, fontWeight: '600', color: colors.primary, marginBottom: 1 },
  body: { fontSize: 15, lineHeight: 20, color: colors.text },
  bodyMine: { color: colors.primaryText },
  time: { fontSize: 10, color: colors.muted, alignSelf: 'flex-end', marginTop: 1 },
  timeMine: { color: 'rgba(255,255,255,0.75)' },
  composer: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    // На телефоне поле растёт вместе с текстом до maxHeight.
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
    color: colors.text,
    backgroundColor: CHAT_BACKGROUND,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
  sendIcon: { color: colors.primaryText, fontSize: 17, marginLeft: 2 },
});
