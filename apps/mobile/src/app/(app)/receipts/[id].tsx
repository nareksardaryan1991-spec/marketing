import Constants from 'expo-constants';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { colors, fonts } from '@/components/theme';
import { Button, Card, ErrorText } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatAmd, formatDateTime } from '@/lib/format';
import { itemLabel, loadReceipt, PROVIDER_NAMES, receiptHtml, type Receipt } from '@/lib/receipt';
import { printReceipt } from '@/lib/receiptPrint';

// Квитанция об оплате: на экране и в PDF через окно печати.
export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useI18n();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    loadReceipt(id)
      .then(setReceipt)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  if (!receipt) {
    return (
      <View style={styles.center}>
        {error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const { payment, order, items } = receipt;
  const save = async () => {
    setPrinting(true);
    try {
      await printReceipt(receiptHtml(receipt, t, language, Constants.expoConfig?.name ?? 'Marketing'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Text style={styles.title}>{t('receipts.receipt', { no: payment.receipt_no ?? '—' })}</Text>
        <Text style={styles.muted}>
          {formatDateTime(payment.updated_at, language)} · {t('receipts.paidBy')}:{' '}
          {PROVIDER_NAMES[payment.provider]}
        </Text>
        <Text style={styles.muted}>
          {t('receipts.client')}: {order.businesses?.name ?? '—'}
        </Text>
        {items.map((item) => (
          <View key={item.id} style={styles.row}>
            <Text style={styles.text}>
              {itemLabel(item, language)} × {item.quantity}
            </Text>
            <Text style={styles.text}>{formatAmd(item.line_total_amd, language)}</Text>
          </View>
        ))}
        {order.discount_amd > 0 && (
          <View style={styles.row}>
            <Text style={styles.text}>
              {t('promo.discount')} ({order.promo_code ?? '—'})
            </Text>
            <Text style={styles.text}>−{formatAmd(order.discount_amd, language)}</Text>
          </View>
        )}
        {order.ad_budget_amd > 0 && (
          <View style={styles.row}>
            <Text style={styles.text}>{t('order.adBudget')}</Text>
            <Text style={styles.text}>{formatAmd(order.ad_budget_amd, language)}</Text>
          </View>
        )}
        <View style={styles.row}>
          <Text style={styles.total}>{t('receipts.paid')}</Text>
          <Text style={styles.total}>{formatAmd(payment.amount_amd, language)}</Text>
        </View>
      </Card>
      <ErrorText>{error}</ErrorText>
      <Button title={t('receipts.save')} onPress={save} loading={printing} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title: { fontSize: 20, fontFamily: fonts.display, color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  text: { flexShrink: 1, fontSize: 15, color: colors.text },
  total: { fontSize: 18, fontWeight: '700', color: colors.text },
});
