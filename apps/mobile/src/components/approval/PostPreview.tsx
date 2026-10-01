import { useState, type ReactNode } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import type { PreviewKind } from '@/lib/approvals';

import { colors } from '../theme';
import type { NumberedMark } from './MarkDots';
import { MediaPage } from './MediaPage';

const MAX_WIDTH = 400;
const RATIO: Record<PreviewKind, number> = { post: 5 / 4, reel: 16 / 9, story: 16 / 9 };

// Материал так, как его увидят в Instagram: пост (4:5, карусель), Reels или история (9:16).
export function PostPreview({
  kind,
  name,
  avatarUrl,
  files,
  urls,
  caption,
  marks = [],
  onPlace,
  placeLabel,
  footer,
}: {
  kind: PreviewKind;
  name: string;
  avatarUrl?: string | null;
  files: string[];
  urls: Record<string, string>;
  caption: string | null;
  marks?: NumberedMark[];
  onPlace?: (path: string, x: number, y: number, seconds: number | null) => void;
  placeLabel?: string;
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const height = Math.round(width * RATIO[kind]);
  const vertical = kind !== 'post';

  const pages = (
    <ScrollView
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1)))}
      style={{ width, height }}>
      {(files.length > 0 ? files : ['']).map((path, i) => (
        <MediaPage
          key={path || i}
          path={path}
          url={urls[path]}
          width={width}
          height={height}
          marks={marks.filter((m) => m.file_path === path)}
          onPlace={onPlace && path ? (x, y, s) => onPlace(path, x, y, s) : undefined}
          placeLabel={placeLabel}
        />
      ))}
    </ScrollView>
  );

  const captionText = caption ? (
    <Text
      style={vertical ? styles.overlayCaption : styles.caption}
      numberOfLines={expanded ? undefined : 2}
      onPress={() => setExpanded((v) => !v)}>
      {!vertical && <Text style={styles.bold}>{name} </Text>}
      {caption}
      {!expanded && caption.length > 90 ? (
        <Text style={vertical ? styles.overlayMore : styles.more}> … {t('approvals.more')}</Text>
      ) : null}
    </Text>
  ) : null;

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => setWidth(Math.min(MAX_WIDTH, Math.floor(e.nativeEvent.layout.width)))}>
      {width > 0 && (
        <View style={[styles.frame, { width }, vertical && styles.frameDark]}>
          {!vertical && <Header name={name} avatarUrl={avatarUrl} />}

          <View>
            {pages}
            {kind === 'story' && (
              <View pointerEvents="none" style={styles.storyTop}>
                <View style={styles.bars}>
                  {(files.length > 0 ? files : ['']).map((_, i) => (
                    <View key={i} style={[styles.bar, i <= index && styles.barOn]} />
                  ))}
                </View>
                <Header name={name} avatarUrl={avatarUrl} light />
              </View>
            )}
            {kind === 'reel' && (
              <View pointerEvents="box-none" style={styles.reelBottom}>
                <View pointerEvents="none">
                  <Header name={name} avatarUrl={avatarUrl} light />
                </View>
                {captionText}
              </View>
            )}
            {kind === 'reel' && (
              <View pointerEvents="none" style={styles.reelSide}>
                <Text style={styles.sideIcon}>♡</Text>
                <Text style={styles.sideIcon}>💬</Text>
                <Text style={styles.sideIcon}>➤</Text>
              </View>
            )}
          </View>

          {kind === 'post' && (
            <View style={styles.body}>
              <View style={styles.actions}>
                <Text style={styles.icon}>♡</Text>
                <Text style={styles.icon}>💬</Text>
                <Text style={styles.icon}>➤</Text>
                <View style={styles.dots}>
                  {files.length > 1 &&
                    files.map((_, i) => (
                      <View key={i} style={[styles.dot, i === index && styles.dotOn]} />
                    ))}
                </View>
                <Text style={styles.icon}>🔖</Text>
              </View>
              {captionText}
            </View>
          )}
        </View>
      )}
      {kind === 'story' && caption ? (
        <Text style={styles.storyCaption}>
          {t('approvals.storyText')}: {caption}
        </Text>
      ) : null}
      {footer}
    </View>
  );
}

function Header({ name, avatarUrl, light }: { name: string; avatarUrl?: string | null; light?: boolean }) {
  return (
    <View style={styles.header}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarEmpty]}>
          <Text style={styles.avatarLetter}>{name.trim().charAt(0).toUpperCase() || '•'}</Text>
        </View>
      )}
      <Text style={[styles.name, light && styles.light]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', alignItems: 'center', gap: 8 },
  frame: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  frameDark: { backgroundColor: '#000000', borderColor: '#000000' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.border },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#C7D2FE' },
  avatarLetter: { fontWeight: '700', color: '#3730A3' },
  name: { flexShrink: 1, fontWeight: '700', fontSize: 14, color: colors.text },
  light: { color: '#FFFFFF' },
  body: { paddingHorizontal: 12, paddingBottom: 12, gap: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 10 },
  icon: { fontSize: 20, color: colors.text },
  dots: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotOn: { backgroundColor: '#3B82F6' },
  caption: { fontSize: 14, lineHeight: 19, color: colors.text },
  bold: { fontWeight: '700' },
  more: { color: colors.muted },
  overlayCaption: { fontSize: 14, lineHeight: 19, color: '#FFFFFF', paddingHorizontal: 10 },
  overlayMore: { color: '#D1D5DB' },
  storyTop: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 8 },
  bars: { flexDirection: 'row', gap: 3, paddingHorizontal: 8 },
  bar: { flex: 1, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.4)' },
  barOn: { backgroundColor: '#FFFFFF' },
  reelBottom: { position: 'absolute', left: 0, right: 48, bottom: 12, gap: 2 },
  reelSide: { position: 'absolute', right: 10, bottom: 24, gap: 18, alignItems: 'center' },
  sideIcon: { fontSize: 24, color: '#FFFFFF' },
  storyCaption: { alignSelf: 'stretch', fontSize: 14, color: colors.muted },
});
