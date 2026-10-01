import { formatAmd, formatDateTime } from './format';
import { platformName, serviceLabel } from './platforms';
import { supabase } from './supabase';
import type { Language, Localized, Order, OrderItem } from './types';

export type ReceiptPayment = {
  id: string;
  order_id: string;
  provider: 'arca' | 'idram' | 'test';
  amount_amd: number;
  receipt_no: number | null;
  updated_at: string;
};

export type Receipt = {
  payment: ReceiptPayment;
  order: Order & { businesses: { name: string } | null };
  items: (OrderItem & { services: { name: Localized } | null })[];
};

export const PROVIDER_NAMES: Record<ReceiptPayment['provider'], string> = {
  arca: 'ArCa',
  idram: 'Idram',
  test: 'Test',
};

export async function loadReceipt(paymentId: string): Promise<Receipt> {
  const { data: payment, error } = await supabase
    .from('payments')
    .select('id, order_id, provider, amount_amd, receipt_no, updated_at')
    .eq('id', paymentId)
    .eq('status', 'succeeded')
    .single<ReceiptPayment>();
  if (error) throw error;
  const [orderRes, itemsRes] = await Promise.all([
    supabase.from('orders').select('*, businesses(name)').eq('id', payment.order_id).single(),
    supabase.from('order_items').select('*, services(name)').eq('order_id', payment.order_id),
  ]);
  if (orderRes.error) throw orderRes.error;
  return {
    payment,
    order: orderRes.data as Receipt['order'],
    items: (itemsRes.data as Receipt['items'] | null) ?? [],
  };
}

export function itemLabel(item: Receipt['items'][number], language: Language): string {
  const platform = platformName(item.platform_id);
  return `${platform ? `${platform} · ` : ''}${serviceLabel(item.service_id, item.services?.name, item.platform_id, language)}`;
}

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// Квитанция для печати и сохранения в PDF.
export function receiptHtml(
  r: Receipt,
  t: (key: string, options?: Record<string, unknown>) => string,
  language: Language,
  agency: string,
): string {
  const amd = (n: number) => escape(formatAmd(n, language));
  const row = (label: string, value: string, bold = false) =>
    `<tr${bold ? ' class="b"' : ''}><td>${label}</td><td class="r">${value}</td></tr>`;
  const date = formatDateTime(r.payment.updated_at, language);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(t('receipts.receipt', { no: r.payment.receipt_no ?? '' }))}</title>
<style>
body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#14151A;margin:32px;font-size:14px}
h1{font-size:22px;margin:0 0 4px} .m{color:#6B7080;margin:0 0 20px}
table{width:100%;border-collapse:collapse} td{padding:8px 0;border-bottom:1px solid #E1E3EA}
.r{text-align:right;white-space:nowrap} .b td{font-weight:700;font-size:16px;border-bottom:none}
</style></head><body>
<h1>${escape(agency)} — ${escape(t('receipts.receipt', { no: r.payment.receipt_no ?? '' }))}</h1>
<p class="m">${escape(date)} · ${escape(t('receipts.paidBy'))}: ${PROVIDER_NAMES[r.payment.provider]}<br>
${escape(t('receipts.client'))}: ${escape(r.order.businesses?.name ?? '')}</p>
<table>
${r.items.map((i) => row(`${escape(itemLabel(i, language))} × ${i.quantity}`, amd(i.line_total_amd))).join('\n')}
${r.order.discount_amd > 0 ? row(`${escape(t('promo.discount'))} (${escape(r.order.promo_code ?? '')})`, `−${amd(r.order.discount_amd)}`) : ''}
${r.order.ad_budget_amd > 0 ? row(escape(t('order.adBudget')), amd(r.order.ad_budget_amd)) : ''}
${row(escape(t('receipts.paid')), amd(r.payment.amount_amd), true)}
</table></body></html>`;
}
