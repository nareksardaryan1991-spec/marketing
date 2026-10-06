import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/i18n';
import { achievements } from '@/lib/achievements';
import { supabase } from '@/lib/supabase';

import { colors } from '../theme';
import { Card } from '../ui';

// «Ваши успехи» на главной клиента — спокойно, без всплывающих окон: появляется
// только когда уже есть публикации.
export function AchievementsCard() {
  const { t } = useI18n();
  const [published, setPublished] = useState<string[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      supabase
        .from('tasks')
        .select('published_at')
        .eq('status', 'published')
        .not('published_at', 'is', null)
        .then(({ data }) => setPublished((data ?? []).map((r) => r.published_at as string)));
    }, []),
  );

  if (!published?.length) return null;
  const { total, streak, goal, left } = achievements(published);

  return (
    <Card>
      <Text style={styles.title}>{t('achievements.title')}</Text>
      <View style={styles.tiles}>
        {streak > 0 && (
          <View style={styles.tile}>
            <Text style={styles.value}>🔥 {streak}</Text>
            <Text style={styles.label}>{t('achievements.streak')}</Text>
          </View>
        )}
        <View style={styles.tile}>
          <Text style={styles.value}>📣 {total}</Text>
          <Text style={styles.label}>{t('achievements.published')}</Text>
        </View>
      </View>
      {goal ? <Text style={styles.muted}>{t('achievements.nextGoal', { goal, left })}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '600', color: colors.text },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, gap: 4, padding: 12, borderRadius: 12, backgroundColor: colors.background },
  label: { fontSize: 13, color: colors.muted },
  value: { fontSize: 28, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  muted: { fontSize: 14, color: colors.muted },
});
