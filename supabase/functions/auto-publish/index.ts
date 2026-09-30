// Автопубликация в Instagram. Запускается по расписанию (Cron в Supabase, каждые 5 минут)
// с заголовком x-cron-secret: <AUTOPUBLISH_SECRET>.
//
// За один запуск задача продвигается на шаг: создать контейнеры → дождаться обработки
// (видео может обрабатываться минутами) → опубликовать. Прогресс хранится в autopublish_state.
import { requireEnv, text } from '../_shared/http.ts';
import {
  containerStatus,
  createContainer,
  InstagramError,
  permalink,
  publishContainer,
  refreshToken,
} from '../_shared/instagram.ts';
import { adminClient } from '../_shared/supabase.ts';

import { buildPlan, PlanError, type PublishPlan } from './plan.ts';

// Сколько ждём обработку видео после наступления времени публикации.
const GIVE_UP_AFTER_MS = 2 * 60 * 60 * 1000;
// Токены живут 60 дней; продлеваем, когда осталось меньше 20.
const REFRESH_WHEN_LEFT_MS = 20 * 24 * 60 * 60 * 1000;

type State = { children?: string[]; container?: string };
type Account = { external_user_id: string; access_token: string };

const admin = adminClient();

async function signedUrl(path: string) {
  const { data, error } = await admin.storage.from('deliverables').createSignedUrl(path, 24 * 60 * 60);
  if (error || !data) throw new Error(`storage: ${error?.message}`);
  return data.signedUrl;
}

async function refreshTokens() {
  const { data: accounts } = await admin
    .from('social_accounts')
    .select('id, access_token, token_expires_at')
    // Токен на 60 дней: «осталось меньше 20» значит, ему больше 40 дней — Instagram
    // разрешает продление, когда токену больше суток.
    .lt('token_expires_at', new Date(Date.now() + REFRESH_WHEN_LEFT_MS).toISOString())
    .gt('token_expires_at', new Date().toISOString());
  for (const account of accounts ?? []) {
    try {
      const fresh = await refreshToken(account.access_token);
      await admin
        .from('social_accounts')
        .update({ access_token: fresh.accessToken, token_expires_at: fresh.expiresAt.toISOString() })
        .eq('id', account.id);
    } catch (e) {
      console.error('token refresh failed', account.id, e);
    }
  }
}

// Один шаг. Возвращает ссылку на пост, когда опубликовано, иначе null (ждём следующего запуска).
async function step(
  taskId: string,
  plan: PublishPlan,
  caption: string | undefined,
  account: Account,
  state: State,
): Promise<{ mediaId: string; url: string | null } | null> {
  const { external_user_id: ig, access_token: token } = account;
  const save = async () => {
    await admin.from('tasks').update({ autopublish_state: state }).eq('id', taskId);
  };

  if (plan.type === 'carousel') {
    if (!state.children) {
      state.children = [];
      for (const file of plan.files) {
        const url = await signedUrl(file.path);
        state.children.push(
          await createContainer(ig, token, {
            ...(file.kind === 'image' ? { image_url: url } : { media_type: 'VIDEO', video_url: url }),
            is_carousel_item: 'true',
          }),
        );
      }
      await save();
    }
    for (const child of state.children) {
      const status = await containerStatus(child, token);
      if (status.code === 'ERROR' || status.code === 'EXPIRED') {
        throw new InstagramError(`Carousel item failed: ${status.detail ?? status.code}`);
      }
      if (status.code !== 'FINISHED') return null;
    }
  }

  if (!state.container) {
    if (plan.type === 'carousel') {
      state.container = await createContainer(ig, token, {
        media_type: 'CAROUSEL',
        children: state.children!.join(','),
        caption,
      });
    } else {
      const url = await signedUrl(plan.file);
      state.container = await createContainer(ig, token, {
        ...(plan.kind === 'image' ? { image_url: url } : { video_url: url }),
        ...(plan.mediaType === 'IMAGE' ? {} : { media_type: plan.mediaType }),
        caption: plan.caption ? caption : undefined,
      });
    }
    await save();
  }

  const status = await containerStatus(state.container, token);
  if (status.code === 'ERROR' || status.code === 'EXPIRED') {
    throw new InstagramError(`Instagram could not process the media: ${status.detail ?? status.code}`);
  }
  if (status.code !== 'FINISHED') return null;

  const mediaId = await publishContainer(ig, token, state.container);
  return { mediaId, url: await permalink(mediaId, token) };
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== requireEnv('AUTOPUBLISH_SECRET')) {
    return text('forbidden', 403);
  }

  await refreshTokens();

  const { data: tasks, error } = await admin
    .from('tasks')
    .select('id, service_id, business_id, publish_at, autopublish_state, orders!inner(publishing)')
    .eq('status', 'publishing')
    .eq('orders.publishing', 'auto')
    // Автопубликация — только Instagram; остальные площадки публикует команда.
    .or('platform_id.eq.instagram,platform_id.is.null')
    .is('autopublish_state->failed', null)
    .order('publish_at')
    .limit(20);
  if (error) return text(error.message, 500);

  const results: string[] = [];
  for (const task of tasks ?? []) {
    const { data: account } = await admin
      .from('social_accounts')
      .select('external_user_id, access_token')
      .eq('business_id', task.business_id)
      .eq('platform', 'instagram')
      .maybeSingle();
    // Без аккаунта публикует команда вручную (напоминание уже отправлено).
    if (!account) continue;

    const { data: latest } = await admin
      .from('deliverables')
      .select('caption, files')
      .eq('task_id', task.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    try {
      const plan = buildPlan(task.service_id, latest?.files ?? []);
      const done = await step(
        task.id,
        plan,
        latest?.caption ?? undefined,
        account,
        (task.autopublish_state ?? {}) as State,
      );
      if (done) {
        await admin.rpc('mark_auto_published', {
          p_task_id: task.id,
          p_media_id: done.mediaId,
          p_url: done.url,
        });
        results.push(`${task.id}: published`);
      } else if (Date.now() - new Date(task.publish_at).getTime() > GIVE_UP_AFTER_MS) {
        throw new InstagramError('Instagram is still processing the media after 2 hours');
      } else {
        results.push(`${task.id}: waiting`);
      }
    } catch (e) {
      const message = e instanceof PlanError || e instanceof InstagramError ? e.message : String(e);
      await admin.rpc('mark_auto_publish_failed', { p_task_id: task.id, p_error: message });
      results.push(`${task.id}: failed (${message})`);
    }
  }

  return text(results.join('\n') || 'nothing to publish');
});
