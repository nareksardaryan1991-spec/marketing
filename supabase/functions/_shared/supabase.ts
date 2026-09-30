import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

import { requireEnv } from './http.ts';

// Полный доступ, обходит RLS. Только для серверного кода.
export function adminClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
}

// Клиент от имени пользователя: запросы проходят через RLS.
export async function userClient(
  req: Request,
): Promise<{ client: SupabaseClient; user: User } | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const client = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser(authHeader.slice('Bearer '.length));
  if (error || !data.user) return null;
  return { client, user: data.user };
}
