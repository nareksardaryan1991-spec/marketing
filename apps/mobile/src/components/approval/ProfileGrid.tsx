import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { isVideo } from '@/lib/approvals';
import { isImage } from '@/lib/files';

import { colors } from '../theme';

export type GridItem = {
  id: string;
  path: string | null;
  url: string | undefined;
  state: 'waiting' | 'approved' | 'published';
};

const GAP = 2;

// Сетка профиля Instagram: сверху то, что выйдет (ждёт решения или одобрено), ниже — уже вышедшее.
export function ProfileGrid({ items, onPress }: { items: GridItem[]; onPress?: (id: string) => void }) {
  const { t } = useI18n();
  const [width, setWidth] = useState(0);
  const side = Math.floor((Math.min(width, 400) - GAP * 2) / 3);

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}>
      {side > 0 && (
        <View style={[styles.grid, { width: side * 3 + GAP * 2 }]}>
          {items.map((item) => (
            <Pressable
              key={item.id}
              disabled={!onPress}
              onPress={() => onPress?.(item.id)}
              style={[styles.tile, { width: side, height: side }]}>
              {item.url && item.path && isImage(item.path) ? (
                <Image source={{ uri: item.url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.empty]}>
                  <Text style={styles.emptyIcon}>{item.path && isVideo(item.path) ? '▶' : '▢'}</Text>
                </View>
              )}
              {item.state !== 'published' && (
                <View style={[styles.badge, item.state === 'waiting' ? styles.waiting : styles.approved]}>
                  <Text style={styles.badgeText}>
                    {item.state === 'waiting' ? t('approvals.gridWaiting') : t('approvals.gridApproved')}
                  </Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { backgroundColor: colors.border, overflow: 'hidden' },
  empty: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1F2937' },
  emptyIcon: { color: '#9CA3AF', fontSize: 22 },
  badge: { position: 'absolute', left: 4, bottom: 4, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  waiting: { backgroundColor: '#DB2777' },
  approved: { backgroundColor: '#059669' },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
});
