// Создаёт платёж по заказу и возвращает, куда отправить пользователя.
// Тело: { order_id, provider: 'arca' | 'idram', return_url, language }
import { corsHeaders, json } from '../_shared/http.ts';
import {
  arcaRegister,
  idramPaymentUrl,
  isAllowedReturnUrl,
  paymentMode,
} from '../_shared/payments.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = await userClient(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);

  const { order_id, provider, return_url, language } = await req.json().catch(() => ({}));
  if (typeof order_id !== 'string' || !['arca', 'idram'].includes(provider)) {
    return json({ error: 'bad request' }, 400);
  }
  if (typeof return_url !== 'string' || !isAllowedReturnUrl(return_url)) {
    return json({ error: 'return_url not allowed' }, 400);
  }
  const lang = ['ru', 'hy', 'en'].includes(language) ? language : 'ru';

  // Читаем заказ от имени пользователя — RLS гарантирует, что заказ его.
  const { data: order } = await auth.client
    .from('orders')
    .select('id, status, total_amd, client_id')
    .eq('id', order_id)
    .maybeSingle();
  if (!order || order.client_id !== auth.user.id) return json({ error: 'order not found' }, 404);
  if (order.status !== 'pending_payment') return json({ error: 'order already paid' }, 409);

  const mode = paymentMode();
  const admin = adminClient();
  const { data: payment, error } = await admin
    .from('payments')
    .insert({
      order_id: order.id,
      provider: mode === 'test' ? 'test' : provider,
      amount_amd: order.total_amd,
      return_url,
    })
    .select('id')
    .single();
  if (error) return json({ error: error.message }, 500);

  if (mode === 'test') {
    return json({ mode: 'test', payment_id: payment.id });
  }

  const description = `Order ${order.id.slice(0, 8)}`;
  try {
    if (provider === 'arca') {
      const returnTo = new URL(`${Deno.env.get('SUPABASE_URL')}/functions/v1/arca-return`);
      returnTo.searchParams.set('payment', payment.id);
      const { orderId, formUrl } = await arcaRegister({
        paymentId: payment.id,
        amountAmd: order.total_amd,
        returnUrl: returnTo.toString(),
        description,
        language: lang,
      });
      await admin.from('payments').update({ provider_payment_id: orderId }).eq('id', payment.id);
      return json({ mode: 'redirect', payment_id: payment.id, url: formUrl });
    }

    const url = idramPaymentUrl({
      paymentId: payment.id,
      amountAmd: order.total_amd,
      description,
      language: lang,
    });
    return json({ mode: 'redirect', payment_id: payment.id, url });
  } catch (e) {
    await admin.rpc('mark_payment_failed', { p_payment_id: payment.id, p_raw: { error: String(e) } });
    return json({ error: 'payment provider error' }, 502);
  }
});
