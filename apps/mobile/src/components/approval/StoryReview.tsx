import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useI18n } from '@/i18n';
import { isVideo, previewKind } from '@/lib/approvals';
import { supabase } from '@/lib/supabase';

import { colors, fonts } from '../theme';
import { Button, ErrorText } from '../ui';
import { PostPreview } from './PostPreview';
import { ReviewItem, type ReviewTask } from './ReviewItem';

// Сколько надо сдвинуть карточку, чтобы засчитать свайп.
const SWIPE = 110;

export type StoryTask = { task: ReviewTask; title: string };

// Материалы на согласовании «как сторис» (оформление G): по одному на весь экран.
// Вправо — одобрить, влево — правки (обычная форма с комментарием и точками на кадре).
// Список запоминается при открытии: после одобрения он не перестраивается, а экран
// «Одобрить» обновляется, когда сторис закрывают (onClose).
export function StoryReview({
  items,
  urls,
  name,
  avatarUrl,
  autoDays,
  onClose,
}: {
  items: StoryTask[];
  urls: Record<string, string>;
  name: string;
  avatarUrl: string | null;
  autoDays: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [list] = useState(items);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<'story' | 'changes'>('story');
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag] = useState(() => new Animated.Value(0));
  // Обработчики свайпа меняются вместе с текущим материалом — жест берёт свежие отсюда.
  const handlers = useRef({ approve: () => {}, changes: () => {} });

  const current = list[index];
  const latest = current
    ? [...current.task.deliverables].sort((a, b) => b.version - a.version)[0]
    : undefined;
  const firstFile = latest?.files[0];
  const photo = firstFile && !isVideo(firstFile) ? urls[firstFile] : undefined;

  const next = () => {
    drag.setValue(0);
    setMode('story');
    setError(null);
    setIndex((i) => i + 1);
  };

  const back = () => Animated.spring(drag, { toValue: 0, useNativeDriver: false }).start();

  const approve = async () => {
    if (!current || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc('client_decide', {
      p_task_id: current.task.id,
      p_approve: true,
      p_comment: null,
      p_marks: null,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      back();
      return;
    }
    setToast(t('approvals.storyApproved', { title: current.title }));
    Animated.timing(drag, { toValue: 600, duration: 220, useNativeDriver: false }).start(next);
  };

  const askChanges = () => {
    back();
    setMode('changes');
  };

  useEffect(() => {
    handlers.current = { approve, changes: askChanges };
  });

  // Стабильные обёртки: сам жест не пересоздаётся при каждой перерисовке.
  const swipe = useMemo(
    () => ({ approve: () => handlers.current.approve(), changes: () => handlers.current.changes() }),
    [],
  );


  const rotate = drag.interpolate({ inputRange: [-300, 0, 300], outputRange: ['-12deg', '0deg', '12deg'] });
  const yesOpacity = drag.interpolate({ inputRange: [0, SWIPE], outputRange: [0, 1], extrapolate: 'clamp' });
  const noOpacity = drag.interpolate({ inputRange: [-SWIPE, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.screen}>
        <View style={styles.progress}>
          {list.map((item, i) => (
            <View key={item.task.id} style={[styles.segment, i <= index && styles.segmentOn]} />
          ))}
        </View>
        <View style={styles.header}>
          <Text style={styles.counter}>
            {current ? t('approvals.storyOf', { n: index + 1, count: list.length }) : ''}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chats.close')}
            onPress={onClose}
            style={styles.close}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>

        {!current ? (
          <View style={styles.done}>
            <Ionicons name="checkmark-circle" size={64} color={colors.success} />
            <Text style={styles.doneTitle}>{t('approvals.storyDone')}</Text>
            {toast && <Text style={styles.muted}>{toast}</Text>}
            <Button title={t('chats.close')} onPress={onClose} />
          </View>
        ) : mode === 'changes' ? (
          <ScrollView contentContainerStyle={styles.changes}>
            <ReviewItem
              task={current.task}
              title={current.title}
              name={name}
              avatarUrl={avatarUrl}
              urls={urls}
              autoDays={autoDays}
              startInChanges
              onDone={next}
            />
            <Button title={t('approvals.storyBack')} variant="ghost" onPress={() => setMode('story')} />
          </ScrollView>
        ) : (
          <>
            <SwipeCard drag={drag} swipe={swipe} style={[styles.card, { transform: [{ translateX: drag }, { rotate }] }]}>
              {photo ? (
                <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <ScrollView contentContainerStyle={styles.preview}>
                  <PostPreview
                    kind={previewKind(current.task.service_id ?? '')}
                    name={name}
                    avatarUrl={avatarUrl}
                    files={latest?.files ?? []}
                    urls={urls}
                    caption={null}
                  />
                </ScrollView>
              )}
              <Animated.View style={[styles.stamp, styles.stampYes, { opacity: yesOpacity }]}>
                <Text style={[styles.stampText, { color: colors.success }]}>{t('approvals.storyYes')}</Text>
              </Animated.View>
              <Animated.View style={[styles.stamp, styles.stampNo, { opacity: noOpacity }]}>
                <Text style={[styles.stampText, { color: colors.warning }]}>{t('approvals.storyChanges')}</Text>
              </Animated.View>
              <View style={styles.caption}>
                <Text style={styles.title}>{current.title}</Text>
                {!!latest?.caption && (
                  <Text style={styles.captionText} numberOfLines={3}>
                    {latest.caption}
                  </Text>
                )}
              </View>
            </SwipeCard>

            <ErrorText>{error}</ErrorText>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('approvals.storyChanges')}
                onPress={askChanges}
                style={styles.round}>
                <Ionicons name="create-outline" size={24} color={colors.text} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('review.approve')}
                onPress={approve}
                disabled={busy}
                style={[styles.round, styles.yes, busy && styles.busy]}>
                <Ionicons name="checkmark" size={36} color={colors.background} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('approvals.storyLater')}
                onPress={next}
                style={styles.round}>
                <Ionicons name="play-skip-forward-outline" size={22} color={colors.text} />
              </Pressable>
            </View>
            <Text style={styles.hint}>{toast ?? t('approvals.storyHint')}</Text>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// Карточка, которую тянут вбок. Жест создаётся один раз; что делать по свайпу — в swipe.
function SwipeCard({
  drag,
  swipe,
  style,
  children,
}: {
  drag: Animated.Value;
  swipe: { approve: () => void; changes: () => void };
  style: ComponentProps<typeof Animated.View>['style'];
  children: ReactNode;
}) {
  const responder = useMemo(() => {
    const reset = () => Animated.spring(drag, { toValue: 0, useNativeDriver: false }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => drag.setValue(g.dx),
      onPanResponderRelease: (_, g) => {
        if (g.dx > SWIPE) swipe.approve();
        else if (g.dx < -SWIPE) swipe.changes();
        else reset();
      },
      onPanResponderTerminate: reset,
    });
  }, [drag, swipe]);
  return (
    <Animated.View {...responder.panHandlers} style={style}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 14, paddingBottom: 12 },
  progress: { flexDirection: 'row', gap: 4, paddingTop: 8 },
  segment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  segmentOn: { backgroundColor: colors.text },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  counter: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  card: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    justifyContent: 'flex-end',
  },
  preview: { padding: 12, paddingBottom: 120 },
  caption: { padding: 18, gap: 6, backgroundColor: 'rgba(0,0,0,0.55)' },
  title: { fontSize: 22, fontFamily: fonts.display, color: '#FFFFFF' },
  captionText: { fontSize: 14, lineHeight: 20, color: '#E8E8EC' },
  stamp: {
    position: 'absolute',
    top: 36,
    borderWidth: 4,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  stampYes: { left: 24, borderColor: colors.success, transform: [{ rotate: '-14deg' }] },
  stampNo: { right: 24, borderColor: colors.warning, transform: [{ rotate: '14deg' }] },
  stampText: { fontSize: 34, fontFamily: fonts.display },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22, paddingTop: 14 },
  round: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  yes: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.success },
  busy: { opacity: 0.6 },
  hint: { textAlign: 'center', fontSize: 13, color: colors.muted, paddingTop: 10 },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  doneTitle: { fontSize: 22, fontFamily: fonts.display, color: colors.text, textAlign: 'center' },
  muted: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  changes: { gap: 12, paddingVertical: 8 },
});
