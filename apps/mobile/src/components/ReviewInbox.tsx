import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';

// Для клиента: сколько материалов ждут его решения — ведёт на экран «На согласовании».
export function ReviewInbox() {
  const { t } = useI18n();
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'client_review')
        .then(({ count }) => setCount(count ?? 0));
    }, []),
  );

  if (count === 0) return null;

  return (
    <Link href="/approvals" asChild>
      <Pressable style={styles.banner}>
        <Text style={styles.text}>{t('review.waiting', { count })}</Text>
        <Text style={styles.arrow}>›</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#FCE7F3',
  },
  text: { flex: 1, fontSize: 16, fontWeight: '600', color: '#9D174D' },
  arrow: { fontSize: 24, color: '#9D174D' },
});
