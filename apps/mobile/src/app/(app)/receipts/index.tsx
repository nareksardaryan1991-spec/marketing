import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { colors } from '@/components/theme';
import { Card, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmd, formatDate } from '@/lib/format';
import { PROVIDER_NAMES, type ReceiptPayment } from '@/lib/receipt';
import { supabase } from '@/lib/supabase';

// «Мои оплаты»: все успешные оплаты клиента с квитанциями.
export default function ReceiptsScreen() {
  const { t, language } = useI18n();
  const [payments, setPayments] = useState<ReceiptPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      supabase
        .from('payments')
        .select('id, order_id, provider, amount_amd, receipt_no, updated_at')
        .eq('status', 'succeeded')
        .order('receipt_no', { ascending: false })
        .then(({ data, error }) => {
          setError(error?.message ?? null);
          setPayments((data as ReceiptPayment[] | null) ?? []);
        });
    }, []),
  );

  return (
    <Screen>
      <ErrorText>{error}</ErrorText>
      {payments?.length === 0 && (
        <Card>
          <Text style={styles.muted}>{t('receipts.empty')}</Text>
        </Card>
      )}
      {payments?.map((p) => (
        <Link key={p.id} href={`/receipts/${p.id}`} asChild>
          <Pressable style={styles.row}>
            <View style={styles.texts}>
              <Text style={styles.title}>🧾 {t('receipts.receipt', { no: p.receipt_no ?? '—' })}</Text>
              <Text style={styles.muted}>
                {formatDate(p.updated_at, language)} · {PROVIDER_NAMES[p.provider]}
              </Text>
            </View>
            <Text style={styles.amount}>{formatAmd(p.amount_amd, language)}</Text>
          </Pressable>
        </Link>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  amount: { fontSize: 16, fontWeight: '700', color: colors.text },
});
