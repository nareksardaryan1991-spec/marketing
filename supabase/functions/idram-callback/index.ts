// RESULT_URL для Idram (указывается в кабинете продавца).
// 1) Предпроверка: EDP_PRECHECK=YES — подтверждаем, что счёт существует и сумма верна.
// 2) Уведомление об оплате с EDP_CHECKSUM — проверяем подпись и отмечаем оплату.
// На оба запроса Idram ждёт ответ "OK".
import { text } from '../_shared/http.ts';
import { idramChecksumValid, sameAmount } from '../_shared/payments.ts';
import { adminClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return text('method not allowed', 405);

  const form = new URLSearchParams(await req.text());
  const billNo = form.get('EDP_BILL_NO');
  if (!billNo || form.get('EDP_REC_ACCOUNT') !== Deno.env.get('IDRAM_REC_ACCOUNT')) {
    return text('bad request', 400);
  }

  const admin = adminClient();
  const { data: payment } = await admin
    .from('payments')
    .select('id, provider, status, amount_amd, orders(status)')
    .eq('id', billNo)
    .maybeSingle();
  if (!payment || payment.provider !== 'idram') return text('bill not found', 404);
  if (!sameAmount(form.get('EDP_AMOUNT'), payment.amount_amd)) return text('wrong amount', 400);

  if (form.get('EDP_PRECHECK') === 'YES') {
    // Заказ уже оплачен (например, другим платежом из второй вкладки) — второй раз не берём.
    // deno-lint-ignore no-explicit-any
    const orderStatus = (payment.orders as any)?.status;
    return payment.status === 'created' && orderStatus === 'pending_payment'
      ? text('OK')
      : text('bill closed', 400);
  }

  if (!(await idramChecksumValid(form))) return text('bad checksum', 400);

  const { error } = await admin.rpc('mark_payment_succeeded', {
    p_payment_id: payment.id,
    p_provider_payment_id: form.get('EDP_TRANS_ID'),
    p_raw: Object.fromEntries(form),
  });
  if (error) return text('error', 500);

  return text('OK');
});
