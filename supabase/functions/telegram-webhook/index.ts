// Webhook Telegram-бота. Привязка: пользователь открывает t.me/<бот>?start=<код>,
// бот получает "/start <код>" и сохраняет chat_id в профиле.
import { requireEnv, text } from '../_shared/http.ts';
import { adminClient } from '../_shared/supabase.ts';

import { TELEGRAM_TEXTS } from '../notify-dispatch/templates.ts';

async function reply(chatId: number, message: string) {
  await fetch(`https://api.telegram.org/bot${requireEnv('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });
}

Deno.serve(async (req) => {
  if (
    req.headers.get('x-telegram-bot-api-secret-token') !== requireEnv('TELEGRAM_WEBHOOK_SECRET')
  ) {
    return text('forbidden', 403);
  }

  const update = await req.json().catch(() => null);
  const message = update?.message;
  const chatId: number | undefined = message?.chat?.id;
  if (!chatId || typeof message.text !== 'string') return text('OK');

  const code = message.text.match(/^\/start\s+([0-9a-f]{32})$/)?.[1];
  const fallbackLang = String(message.from?.language_code ?? '').slice(0, 2);
  const lang = (['ru', 'hy', 'en'].includes(fallbackLang) ? fallbackLang : 'ru') as 'ru' | 'hy' | 'en';

  if (!code) {
    await reply(chatId, TELEGRAM_TEXTS.howTo[lang]);
    return text('OK');
  }

  const admin = adminClient();
  const { data: profile } = await admin
    .from('profiles')
    .update({ telegram_chat_id: chatId, telegram_link_code: null })
    .eq('telegram_link_code', code)
    .select('language')
    .maybeSingle();

  const profileLang = (profile?.language ?? lang) as 'ru' | 'hy' | 'en';
  await reply(chatId, profile ? TELEGRAM_TEXTS.linked[profileLang] : TELEGRAM_TEXTS.howTo[lang]);
  return text('OK');
});
