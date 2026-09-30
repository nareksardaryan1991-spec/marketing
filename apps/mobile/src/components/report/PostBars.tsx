import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';
import { chart, compactNumber } from './chartTokens';

export type PostBar = {
  id: string;
  title: string;
  subtitle: string;
  reach: number;
  details: string;
  url: string | null;
};

// Охват каждой публикации: горизонтальные столбики от общей базовой линии.
// Лучшая публикация — акцентным цветом, остальные — приглушённым (форма «выделение»).
export function PostBars({ posts, locale }: { posts: PostBar[]; locale: string }) {
  const max = Math.max(1, ...posts.map((p) => p.reach));
  const bestId = posts.reduce<PostBar | null>(
    (best, p) => (!best || p.reach > best.reach ? p : best),
    null,
  )?.id;

  return (
    <View style={styles.list}>
      {posts.map((post) => {
        const best = post.id === bestId && post.reach > 0;
        return (
          <Pressable
            key={post.id}
            disabled={!post.url}
            onPress={() => post.url && WebBrowser.openBrowserAsync(post.url)}
            accessibilityRole={post.url ? 'link' : undefined}
            accessibilityLabel={`${post.title}, ${post.subtitle}, ${post.reach}. ${post.details}`}
            style={styles.row}>
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>
                {post.title}
              </Text>
              <Text style={styles.subtitle}>{post.subtitle}</Text>
            </View>
            <View style={styles.barRow}>
              <View style={styles.track}>
                <View
                  style={[
                    styles.bar,
                    {
                      width: `${Math.max(2, (post.reach / max) * 100)}%`,
                      backgroundColor: best ? chart.accent : chart.deemphasis,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.value, best && styles.valueBest]}>
                {compactNumber(post.reach, locale)}
              </Text>
            </View>
            <Text style={styles.details}>{post.details}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 14 },
  row: { gap: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text },
  subtitle: { fontSize: 13, color: colors.muted },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1 },
  // Тонкий столбик, скругление 4px только на конце данных.
  bar: { height: 12, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  value: { minWidth: 48, fontSize: 14, color: colors.muted, fontVariant: ['tabular-nums'] },
  valueBest: { color: colors.text, fontWeight: '600' },
  details: { fontSize: 13, color: colors.muted },
});
