// Отправляет уведомление из таблицы notifications в Telegram, push приложения и web push.
// Вызывается Database Webhook'ом на INSERT в public.notifications
// с заголовком x-webhook-secret: <NOTIFY_WEBHOOK_SECRET>.
import webpush from 'npm:web-push@3.6.7';

import { requireEnv, text } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';

import { renderNotification } from './templates.ts';

type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  payload: Record<string, unknown>;
};

async function sendTelegram(chatId: number, message: string) {
  const res = await fetch(
    `https://api.telegram.org/bot${requireEnv('TELEGRAM_BOT_TOKEN')}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    },
  );
  if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text()}`);
}

// Возвращает false, если токен устройства больше не действителен.
async function sendPush(token: string, message: string, data: Record<string, unknown>) {
  const [title, ...rest] = message.split('\n');
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ to: token, title, body: rest.join('\n') || undefined, data, sound: 'default' }),
  });
  const result = await res.json();
  const ticket = result?.data;
  if (ticket?.status === 'error') {
    if (ticket.details?.error === 'DeviceNotRegistered') return false;
    throw new Error(`push: ${ticket.message}`);
  }
  if (!res.ok) throw new Error(`push ${res.status}`);
  return true;
}

type WebPushSubscription = { endpoint: string; p256dh: string; auth: string };

// Web push в браузер и в сайт на экране «Домой». Без ключей VAPID не отправляется.
// VAPID_SUBJECT — адрес сайта (https://...) или mailto: для связи с владельцем.
// Возвращает false, если подписка больше не действительна (браузер отписался).
const vapid = {
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY'),
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY'),
  subject: Deno.env.get('VAPID_SUBJECT'),
};
async function sendWebPush(sub: WebPushSubscription, message: string, data: Record<string, unknown>) {
  const [title, ...rest] = message.split('\n');
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title, body: rest.join('\n'), data }),
      {
        vapidDetails: { subject: vapid.subject!, publicKey: vapid.publicKey!, privateKey: vapid.privateKey! },
        TTL: 60 * 60 * 24,
      },
    );
    return true;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return false;
    throw new Error(`web push ${status ?? ''}: ${(e as Error).message}`);
  }
}

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== requireEnv('NOTIFY_WEBHOOK_SECRET')) {
    return text('forbidden', 403);
  }
  const { record } = (await req.json()) as { record: NotificationRow };
  if (!record?.id) return text('bad request', 400);

  const admin = adminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('language, expo_push_token, telegram_chat_id')
    .eq('id', record.user_id)
    .single();
  if (!profile) return text('no profile');

  const payload = record.payload ?? {};
  let service = String(payload.service_id ?? '');
  if (payload.service_id) {
    const { data } = await admin.from('services').select('name').eq('id', payload.service_id).single();
    service = data?.name?.[profile.language] ?? data?.name?.ru ?? service;
  }
  // «Facebook · Пост» — площадка перед названием услуги.
  if (payload.platform) service = `${payload.platform} · ${service}`;
  const vars = Object.fromEntries(
    Object.entries({ ...payload, service }).map(([k, v]) => [k, v == null ? '' : String(v)]),
  );
  // Звонок: ссылка на комнату на сервере звонков (JITSI_URL, по умолчанию meet.jit.si).
  if (payload.room) {
    const base = (Deno.env.get('JITSI_URL') || 'https://meet.jit.si').replace(/\/+$/, '');
    vars.call_url = `${base}/${payload.room}`;
  }
  const message = renderNotification(record.kind, profile.language, vars);
  if (!message) return text('unknown kind');

  const errors: string[] = [];
  if (profile.telegram_chat_id) {
    await sendTelegram(profile.telegram_chat_id, message).catch((e) => errors.push(String(e)));
  }
  const data = {
    kind: record.kind,
    order_id: payload.order_id,
    task_id: payload.task_id,
    conversation_id: payload.conversation_id,
  };
  if (profile.expo_push_token) {
    try {
      const valid = await sendPush(profile.expo_push_token, message, data);
      if (!valid) {
        await admin.from('profiles').update({ expo_push_token: null }).eq('id', record.user_id);
      }
    } catch (e) {
      errors.push(String(e));
    }
  }

  if (vapid.publicKey && vapid.privateKey && vapid.subject) {
    const { data: subs } = await admin
      .from('web_push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', record.user_id);
    await Promise.all(
      (subs ?? []).map(async (sub) => {
        try {
          if (!(await sendWebPush(sub, message, data))) {
            await admin.from('web_push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
        } catch (e) {
          errors.push(String(e));
        }
      }),
    );
  }

  await admin
    .from('notifications')
    .update({ sent_at: new Date().toISOString(), error: errors.join('; ') || null })
    .eq('id', record.id);

  return text('OK');
});
