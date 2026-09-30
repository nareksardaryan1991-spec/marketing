// Redirect URI приложения Instagram: сюда Instagram возвращает ?code=…&state=…
import { text } from '../_shared/http.ts';
import { connectWithCode } from '../_shared/instagram.ts';
import { adminClient } from '../_shared/supabase.ts';

const STATE_TTL_MS = 15 * 60 * 1000;

function back(returnUrl: string, result: string) {
  const url = new URL(returnUrl);
  url.searchParams.set('instagram', result);
  return Response.redirect(url.toString(), 302);
}

Deno.serve(async (req) => {
  const params = new URL(req.url).searchParams;
  const state = params.get('state');
  if (!state) return text('bad request', 400);

  // state одноразовый: забираем и сразу удаляем.
  const admin = adminClient();
  const { data: saved } = await admin
    .from('oauth_states')
    .delete()
    .eq('state', state)
    .select()
    .maybeSingle();
  if (!saved) return text('link expired, try again from the app', 400);
  if (Date.now() - new Date(saved.created_at).getTime() > STATE_TTL_MS) {
    return back(saved.return_url, 'expired');
  }

  const code = params.get('code');
  if (!code) return back(saved.return_url, 'cancelled');

  try {
    const account = await connectWithCode(code);
    const { error } = await admin.from('social_accounts').upsert(
      {
        business_id: saved.business_id,
        platform: 'instagram',
        external_user_id: account.userId,
        username: account.username,
        access_token: account.accessToken,
        token_expires_at: account.expiresAt.toISOString(),
        connected_by: saved.user_id,
      },
      { onConflict: 'business_id,platform' },
    );
    if (error) throw error;
    return back(saved.return_url, 'connected');
  } catch (e) {
    console.error('instagram connect failed', e);
    return back(saved.return_url, 'error');
  }
});
