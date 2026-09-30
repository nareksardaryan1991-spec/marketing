import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';

// Для клиента: сколько материалов ждут его решения.
export function ReviewInbox() {
  const { t } = useI18n();
  const [byOrder, setByOrder] = useState<[string, number][]>([]);

  useFocusEffect(
    useCallback(() => {
      supabase
        .from('tasks')
        .select('order_id')
        .eq('status', 'client_review')
        .then(({ data }) => {
          const counts = new Map<string, number>();
          for (const row of data ?? []) {
            counts.set(row.order_id, (counts.get(row.order_id) ?? 0) + 1);
          }
          setByOrder([...counts.entries()]);
        });
    }, []),
  );

  return (
    <>
      {byOrder.map(([orderId, count]) => (
        <Link key={orderId} href={`/orders/${orderId}`} asChild>
          <Pressable style={styles.banner}>
            <Text style={styles.text}>{t('review.waiting', { count })}</Text>
            <Text style={styles.arrow}>›</Text>
          </Pressable>
        </Link>
      ))}
    </>
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
