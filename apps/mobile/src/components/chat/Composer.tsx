import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useState, type ReactNode } from 'react';
import {
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';

import { useI18n } from '@/i18n';
import { formatDuration, MAX_FILE_BYTES, pickChatFiles, type PendingFile } from '@/lib/chat';

import { chatColors } from './chatTheme';

export type ComposerBanner = { icon: string; title: string; text: string } | null;

// Поле ввода как в Telegram: скрепка, текст, справа микрофон или «отправить».
// Над полем — полоса «Ответ …» или «Редактирование» и выбранные файлы.
export function Composer({
  draft,
  onDraftChange,
  files,
  onFilesChange,
  banner,
  onCancelBanner,
  editing,
  onSend,
  onSendVoice,
  onTyping,
  extra,
}: {
  draft: string;
  onDraftChange: (text: string) => void;
  files: PendingFile[];
  onFilesChange: (files: PendingFile[]) => void;
  banner: ComposerBanner;
  onCancelBanner: () => void;
  editing: boolean;
  onSend: () => Promise<string | null>;
  onSendVoice: (file: PendingFile) => Promise<string | null>;
  onTyping: () => void;
  extra?: ReactNode;
}) {
  const { t } = useI18n();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachMenu, setAttachMenu] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [recording, setRecording] = useState(false);

  const canSend = !!draft.trim() || (files.length > 0 && !editing);

  const send = async () => {
    if (!canSend || sending) return;
    setError(null);
    setSending(true);
    const failure = await onSend();
    setSending(false);
    if (failure) setError(failure);
  };

  // На компьютере Enter отправляет, Shift+Enter — новая строка. На телефоне Enter — перенос.
  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const event = e.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean };
    if (Platform.OS !== 'web' || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    e.preventDefault();
    send();
  };

  const attach = async (media: boolean) => {
    setAttachMenu(false);
    setError(null);
    try {
      const picked = await pickChatFiles(media);
      const tooBig = picked.find((f) => (f.size ?? 0) > MAX_FILE_BYTES);
      if (tooBig) setError(t('chats.tooBig', { name: tooBig.name }));
      onFilesChange([...files, ...picked.filter((f) => (f.size ?? 0) <= MAX_FILE_BYTES)].slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const startRecording = async () => {
    setError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError(t('chats.micDenied'));
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const stopRecording = async (keep: boolean) => {
    const duration = recorderState.durationMillis / 1000;
    setRecording(false);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      // запись уже остановлена
    }
    const uri = recorder.uri;
    if (!keep || !uri || duration < 0.5) return;
    let mime = 'audio/mp4';
    if (Platform.OS === 'web') {
      mime = ((await (await fetch(uri)).blob()).type || 'audio/webm').split(';')[0];
    }
    const ext = mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : 'm4a';
    setSending(true);
    const failure = await onSendVoice({
      key: `voice-${Date.now()}`,
      uri,
      name: `voice-${Date.now()}.${ext}`,
      mime,
      kind: 'voice',
      duration,
    });
    setSending(false);
    if (failure) setError(failure);
  };

  return (
    <View style={styles.wrap}>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {extra}
      {banner && (
        <View style={styles.banner}>
          <Text style={styles.bannerIcon}>{banner.icon}</Text>
          <View style={styles.bannerText}>
            <Text style={styles.bannerTitle} numberOfLines={1}>
              {banner.title}
            </Text>
            <Text style={styles.bannerBody} numberOfLines={1}>
              {banner.text}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('chats.cancel')} onPress={onCancelBanner}>
            <Text style={styles.bannerClose}>✕</Text>
          </Pressable>
        </View>
      )}
      {files.length > 0 && (
        <View style={styles.files}>
          {files.map((file) => (
            <View key={file.key} style={styles.fileChip}>
              {file.kind === 'photo' ? (
                <Image source={{ uri: file.uri }} style={styles.fileThumb} />
              ) : (
                <Text style={styles.fileIcon}>{file.kind === 'video' ? '🎬' : '📄'}</Text>
              )}
              <Text style={styles.fileName} numberOfLines={1}>
                {file.name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('chats.cancel')}
                onPress={() => onFilesChange(files.filter((f) => f.key !== file.key))}>
                <Text style={styles.fileRemove}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {recording ? (
        <View style={styles.row}>
          <View style={styles.recording}>
            <View style={styles.redDot} />
            <Text style={styles.recordingText}>
              {t('chats.recording')} {formatDuration(recorderState.durationMillis / 1000)}
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => stopRecording(false)} style={styles.cancelRec}>
            <Text style={styles.cancelRecText}>{t('chats.cancel')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('task.send')}
            onPress={() => stopRecording(true)}
            style={styles.round}>
            <Text style={styles.roundIcon}>➤</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.row}>
          {!editing && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('chats.attach')}
              onPress={() => setAttachMenu(true)}
              style={styles.iconButton}>
              <Text style={styles.clip}>📎</Text>
            </Pressable>
          )}
          <TextInput
            value={draft}
            onChangeText={(text) => {
              onDraftChange(text);
              onTyping();
            }}
            onKeyPress={onKeyPress}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={chatColors.meta}
            multiline
            // В браузере многострочное поле по умолчанию в две строки — делаем одну.
            numberOfLines={1}
            style={styles.input}
          />
          {canSend || editing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('task.send')}
              onPress={send}
              disabled={sending || !canSend}
              style={[styles.round, (sending || !canSend) && styles.disabled]}>
              <Text style={styles.roundIcon}>{editing ? '✓' : '➤'}</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('chats.recordVoice')}
              onPress={startRecording}
              disabled={sending}
              style={[styles.round, styles.mic, sending && styles.disabled]}>
              <Text style={styles.micIcon}>🎤</Text>
            </Pressable>
          )}
        </View>
      )}

      <Modal transparent animationType="fade" visible={attachMenu} onRequestClose={() => setAttachMenu(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setAttachMenu(false)}>
          <View style={styles.menu}>
            <Pressable accessibilityRole="button" onPress={() => attach(true)} style={styles.menuItem}>
              <Text style={styles.menuIcon}>🖼</Text>
              <Text style={styles.menuText}>{t('chats.attachMedia')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => attach(false)} style={styles.menuItem}>
              <Text style={styles.menuIcon}>📄</Text>
              <Text style={styles.menuText}>{t('chats.attachFile')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E1E3EA',
  },
  error: { color: '#DC2626', fontSize: 13, paddingHorizontal: 6 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 },
  bannerIcon: { fontSize: 18, color: chatColors.accent },
  bannerText: { flex: 1, borderLeftWidth: 2, borderLeftColor: chatColors.accent, paddingLeft: 8 },
  bannerTitle: { fontSize: 13, fontWeight: '700', color: chatColors.accent },
  bannerBody: { fontSize: 13, color: chatColors.text },
  bannerClose: { fontSize: 18, color: chatColors.meta, padding: 4 },
  files: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 4 },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    paddingRight: 8,
    borderRadius: 10,
    backgroundColor: '#F1F3F7',
    overflow: 'hidden',
  },
  fileThumb: { width: 40, height: 40 },
  fileIcon: { fontSize: 20, paddingLeft: 8, paddingVertical: 8 },
  fileName: { flexShrink: 1, fontSize: 13, color: chatColors.text },
  fileRemove: { fontSize: 14, color: chatColors.meta, padding: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  clip: { fontSize: 22 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
    color: chatColors.text,
    backgroundColor: '#F1F3F7',
  },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: chatColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundIcon: { color: '#FFFFFF', fontSize: 17, marginLeft: 2, fontWeight: '700' },
  mic: { backgroundColor: 'transparent' },
  micIcon: { fontSize: 22 },
  disabled: { opacity: 0.4 },
  recording: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingLeft: 10 },
  redDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444' },
  recordingText: { fontSize: 15, color: chatColors.text },
  cancelRec: { paddingHorizontal: 10, height: 40, justifyContent: 'center' },
  cancelRecText: { color: chatColors.accent, fontSize: 15, fontWeight: '600' },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: 16,
  },
  menu: { width: '100%', maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: 16, paddingVertical: 6 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 14 },
  menuIcon: { fontSize: 20 },
  menuText: { fontSize: 16, color: chatColors.text },
});
