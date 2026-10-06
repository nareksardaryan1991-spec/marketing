// Тестовая оплата (только при PAYMENT_MODE=test). Тело: { payment_id, success }
// Подтверждает только владелец агентства: пока банк не подключён, клиент не может «оплатить» заказ сам.
import { corsHeaders, json } from '../_shared/http.ts';
import { paymentMode } from '../_shared/payments.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (paymentMode() !== 'test') return json({ error: 'test payments disabled' }, 403);

  const auth = await userClient(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  // Роль проверяет база (is_admin) — те же правила, что и везде.
  const { data: isAdmin } = await auth.client.rpc('is_admin');
  if (isAdmin !== true) return json({ error: 'only the owner can confirm test payments' }, 403);

  const { payment_id, success } = await req.json().catch(() => ({}));
  if (typeof payment_id !== 'string') return json({ error: 'bad request' }, 400);

  // RLS: владелец видит платежи по всем заказам.
  const { data: payment } = await auth.client
    .from('payments')
    .select('id, provider')
    .eq('id', payment_id)
    .maybeSingle();
  if (!payment || payment.provider !== 'test') return json({ error: 'payment not found' }, 404);

  const admin = adminClient();
  const { error } = success
    ? await admin.rpc('mark_payment_succeeded', {
        p_payment_id: payment.id,
        p_provider_payment_id: `test-${Date.now()}`,
        p_raw: { test: true },
      })
    : await admin.rpc('mark_payment_failed', { p_payment_id: payment.id, p_raw: { test: true } });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
});
