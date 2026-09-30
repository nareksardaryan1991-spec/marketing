// Сбор статистики Instagram для отчётов. Запускается по расписанию (pg_cron, каждые 6 часов)
// с заголовком x-cron-secret: <AUTOPUBLISH_SECRET>.
import { requireEnv, text } from '../_shared/http.ts';
import {
  accountInfo,
  accountInsights,
  InstagramError,
  mediaInfo,
  mediaInsights,
  normalizePermalink,
  recentMediaByPermalink,
} from '../_shared/instagram.ts';
import { adminClient } from '../_shared/supabase.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
// Обновляем цифры публикаций за последние 60 дней.
const POSTS_WINDOW_MS = 60 * DAY_MS;

const admin = adminClient();

type Account = {
  business_id: string;
  external_user_id: string;
  access_token: string;
};

async function collectAccount(account: Account): Promise<string> {
  const { business_id: businessId, external_user_id: ig, access_token: token } = account;

  // 1. Аккаунт: подписчики и итоги за 30 дней.
  const now = new Date();
  const [info, totals] = await Promise.all([
    accountInfo(token),
    accountInsights(ig, token, new Date(now.getTime() - 30 * DAY_MS), now),
  ]);
  await admin.from('account_snapshots').upsert(
    {
      business_id: businessId,
      taken_on: now.toISOString().slice(0, 10),
      followers_count: info.followers,
      media_count: info.media,
      metrics_30d: totals,
      fetched_at: now.toISOString(),
    },
    { onConflict: 'business_id,taken_on' },
  );

  // 2. Наши опубликованные задачи.
  const { data: tasks } = await admin
    .from('tasks')
    .select('id, published_url, autopublish_state')
    .eq('business_id', businessId)
    .eq('status', 'published')
    .gte('published_at', new Date(now.getTime() - POSTS_WINDOW_MS).toISOString());

  let byPermalink: Map<string, string> | null = null;
  let updated = 0;
  for (const task of tasks ?? []) {
    let mediaId: string | undefined = task.autopublish_state?.media_id;
    // Опубликовано вручную — ищем пост по ссылке среди последних публикаций аккаунта.
    if (!mediaId && task.published_url) {
      byPermalink ??= await recentMediaByPermalink(ig, token);
      mediaId = byPermalink.get(normalizePermalink(task.published_url));
    }
    if (!mediaId) continue;

    try {
      const media = await mediaInfo(mediaId, token);
      const metrics = await mediaInsights(mediaId, media.productType, token);
      await admin.from('post_metrics').upsert({
        task_id: task.id,
        business_id: businessId,
        media_id: mediaId,
        permalink: media.permalink,
        media_type: media.productType ?? media.mediaType,
        metrics,
        fetched_at: now.toISOString(),
      });
      updated++;
    } catch (e) {
      // Истории через 24 часа и удалённые посты больше не отдают статистику — оставляем последние цифры.
      console.warn('media insights failed', task.id, String(e));
    }
  }
  return `${updated} posts`;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== requireEnv('AUTOPUBLISH_SECRET')) {
    return text('forbidden', 403);
  }

  const { data: accounts, error } = await admin
    .from('social_accounts')
    .select('id, business_id, external_user_id, access_token')
    .eq('platform', 'instagram')
    .gt('token_expires_at', new Date().toISOString());
  if (error) return text(error.message, 500);

  const results: string[] = [];
  for (const account of accounts ?? []) {
    try {
      const summary = await collectAccount(account);
      await admin
        .from('social_accounts')
        .update({ insights_error: null, insights_updated_at: new Date().toISOString() })
        .eq('id', account.id);
      results.push(`${account.business_id}: ${summary}`);
    } catch (e) {
      const message = e instanceof InstagramError ? e.message : String(e);
      await admin.from('social_accounts').update({ insights_error: message }).eq('id', account.id);
      results.push(`${account.business_id}: failed (${message})`);
    }
  }
  return text(results.join('\n') || 'no accounts');
});
