// Начало подключения Instagram. Тело: { business_id, return_url } → { url } страницы входа Instagram.
import { corsHeaders, json } from '../_shared/http.ts';
import { authorizeUrl } from '../_shared/instagram.ts';
import { isAllowedReturnUrl } from '../_shared/payments.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = await userClient(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);

  const { business_id, return_url } = await req.json().catch(() => ({}));
  if (typeof business_id !== 'string') return json({ error: 'bad request' }, 400);
  if (typeof return_url !== 'string' || !isAllowedReturnUrl(return_url)) {
    return json({ error: 'return_url not allowed' }, 400);
  }

  // Подключать может владелец бизнеса или менеджер.
  const [{ data: business }, { data: isManager }] = await Promise.all([
    auth.client.from('businesses').select('owner_id').eq('id', business_id).maybeSingle(),
    auth.client.rpc('is_manager'),
  ]);
  if (!business || (business.owner_id !== auth.user.id && !isManager)) {
    return json({ error: 'business not found' }, 404);
  }

  const state = crypto.randomUUID().replaceAll('-', '');
  const { error } = await adminClient()
    .from('oauth_states')
    .insert({ state, business_id, user_id: auth.user.id, return_url });
  if (error) return json({ error: error.message }, 500);

  return json({ url: authorizeUrl(state) });
});
