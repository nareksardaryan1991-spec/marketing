// Сюда ArCa возвращает пользователя после оплаты: ?payment=<id>&orderId=<id в шлюзе>.
// Проверяем статус в шлюзе и отправляем пользователя обратно в приложение.
import { text } from '../_shared/http.ts';
import { arcaStatus } from '../_shared/payments.ts';
import { adminClient } from '../_shared/supabase.ts';

const PAID = 2;
const FAILED = [3, 6];

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const paymentId = url.searchParams.get('payment');
  if (!paymentId) return text('bad request', 400);

  const admin = adminClient();
  const { data: payment } = await admin
    .from('payments')
    .select('id, provider, provider_payment_id, amount_amd, return_url')
    .eq('id', paymentId)
    .maybeSingle();
  if (!payment || payment.provider !== 'arca' || !payment.provider_payment_id) {
    return text('payment not found', 404);
  }

  // Статус берём у шлюза по сохранённому orderId, а не из параметров запроса.
  const status = await arcaStatus(payment.provider_payment_id);
  const amountOk = Number(status.amount) === payment.amount_amd * 100;

  if (status.orderStatus === PAID && amountOk) {
    await admin.rpc('mark_payment_succeeded', {
      p_payment_id: payment.id,
      p_provider_payment_id: payment.provider_payment_id,
      p_raw: status,
    });
  } else if (FAILED.includes(status.orderStatus) || (status.orderStatus === PAID && !amountOk)) {
    await admin.rpc('mark_payment_failed', { p_payment_id: payment.id, p_raw: status });
  }

  return Response.redirect(payment.return_url ?? 'marketing://', 302);
});
