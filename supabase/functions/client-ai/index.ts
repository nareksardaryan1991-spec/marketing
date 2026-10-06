// AI в кабинете клиента. Тело: { mode: 'welcome' | 'ideas', language?: 'ru' | 'hy' | 'en' }.
// welcome — подарок после знакомства: 3 примера постов и контент-план на неделю (один раз на клиента).
// ideas — 2–3 идеи задач от агентов на эту неделю (один раз в неделю на бизнес).
// Работа идёт в фоне: функция сразу отвечает, результат появляется в welcome_kits / task_ideas.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { businessProfile } from '../_shared/business.ts';
import { askClaude } from '../_shared/claude.ts';
import { corsHeaders, json } from '../_shared/http.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';
import {
  type Idea,
  ideasSchema,
  ideasSystem,
  WELCOME_SCHEMA,
  type WelcomeKit,
  welcomeSystem,
} from './prompts.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const nameOf = (value: unknown) => {
  const v = value as Record<string, string> | null;
  return v?.en ?? v?.ru ?? '';
};

// Понедельник текущей недели по Еревану (UTC+4, без перехода на летнее время).
function weekStart(): string {
  const yerevan = new Date(Date.now() + 4 * 3600_000);
  yerevan.setUTCDate(yerevan.getUTCDate() - ((yerevan.getUTCDay() + 6) % 7));
  return yerevan.toISOString().slice(0, 10);
}

function background(work: Promise<void>) {
  const done = work.catch((e) => console.error('client-ai failed', e));
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(done);
}

// deno-lint-ignore no-explicit-any
type Business = Record<string, any>;

async function makeWelcome(business: Business, clientId: string, language: string) {
  const admin = adminClient();
  try {
    const result = await askClaude(
      welcomeSystem(language),
      `${businessProfile(business)}\n\n## Today\n${new Date().toISOString().slice(0, 10)}`,
      WELCOME_SCHEMA,
    );
    if (!result.ok) throw new Error((await result.response.json().catch(() => null))?.error ?? 'AI error');
    const kit = JSON.parse(result.text) as WelcomeKit;
    kit.posts = kit.posts.slice(0, 3);
    kit.plan = kit.plan.slice(0, 7);
    await admin
      .from('welcome_kits')
      .update({
        status: 'done',
        result: kit,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        finished_at: new Date().toISOString(),
      })
      .eq('client_id', clientId);
  } catch (e) {
    await admin
      .from('welcome_kits')
      .update({ status: 'failed', error: e instanceof Error ? e.message : String(e), finished_at: new Date().toISOString() })
      .eq('client_id', clientId);
    throw e;
  }
}

async function makeIdeas(db: SupabaseClient, business: Business, week: string, language: string) {
  const admin = adminClient();
  try {
    const [servicesRes, offersRes, ordersRes, pastRes] = await Promise.all([
      db.from('services').select('id, name, per_platform').eq('active', true),
      db.from('platform_services').select('platform_id, service_id, label, platforms(name, active)').eq('active', true),
      db
        .from('orders')
        .select('created_at, notes, order_items(quantity, services(name), platforms(name))')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false })
        .limit(5),
      admin
        .from('task_ideas')
        .select('title, status')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false })
        .limit(12),
    ]);

    // Что можно заказать: «услуга@площадка» для постов, историй и рилсов, просто «услуга» для общих.
    const offers: Record<string, { service: string; platform: string | null; label: string }> = {};
    for (const s of servicesRes.data ?? []) {
      if (!s.per_platform) offers[s.id] = { service: s.id, platform: null, label: nameOf(s.name) };
    }
    for (const o of offersRes.data ?? []) {
      // deno-lint-ignore no-explicit-any
      const platform = o.platforms as any;
      const service = (servicesRes.data ?? []).find((s) => s.id === o.service_id);
      if (!platform?.active || !service?.per_platform) continue;
      offers[`${o.service_id}@${o.platform_id}`] = {
        service: o.service_id,
        platform: o.platform_id,
        label: `${platform.name} ${nameOf(o.label) || nameOf(service.name)}`,
      };
    }
    const keys = Object.keys(offers);
    if (!keys.length) throw new Error('no services to suggest');

    const orders = (ordersRes.data ?? [])
      .map((o) => {
        // deno-lint-ignore no-explicit-any
        const items = ((o.order_items ?? []) as any[])
          .map((i) => `${i.platforms?.name ? `${i.platforms.name} ` : ''}${nameOf(i.services?.name)} × ${i.quantity}`)
          .join(', ');
        return `- ${o.created_at.slice(0, 10)}: ${items}${o.notes ? ` (${String(o.notes).slice(0, 200)})` : ''}`;
      })
      .join('\n');
    const prompt = [
      businessProfile(business),
      `## Today\n${new Date().toISOString().slice(0, 10)}`,
      `## What the client can order (offer: name)\n${keys.map((k) => `- ${k}: ${offers[k].label}`).join('\n')}`,
      orders ? `## Recent orders\n${orders}` : '',
      (pastRes.data ?? []).length
        ? `## Ideas the client already got\n${(pastRes.data ?? []).map((i) => `- ${i.title} (${i.status})`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const result = await askClaude(ideasSystem(language), prompt, ideasSchema(keys));
    if (!result.ok) throw new Error((await result.response.json().catch(() => null))?.error ?? 'AI error');
    const ideas = (JSON.parse(result.text) as { ideas: Idea[] }).ideas.filter((i) => offers[i.offer]).slice(0, 3);
    if (!ideas.length) throw new Error('AI returned no ideas');

    const { error } = await admin.from('task_ideas').insert(
      ideas.map((i) => ({
        business_id: business.id,
        week_start: week,
        agent: i.agent,
        title: i.title.trim().slice(0, 120),
        description: i.description.trim().slice(0, 600),
        service_id: offers[i.offer].service,
        platform_id: offers[i.offer].platform,
      })),
    );
    if (error) throw new Error(error.message);
    await admin.from('idea_batches').update({ status: 'done' }).eq('business_id', business.id).eq('week_start', week);
  } catch (e) {
    // Неделю освобождаем — при следующем заходе клиента попробуем ещё раз.
    await admin.from('idea_batches').delete().eq('business_id', business.id).eq('week_start', week);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = await userClient(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  if (body.mode !== 'welcome' && body.mode !== 'ideas') return json({ error: 'bad request' }, 400);

  // Всё про бизнес читаем от имени клиента: только свой бизнес.
  const db = auth.client;
  const { data: profile } = await db.from('profiles').select('role, language').eq('id', auth.user.id).single();
  if (profile?.role !== 'client') return json({ error: 'forbidden' }, 403);
  const { data: business } = await db
    .from('businesses')
    .select('*')
    .eq('owner_id', auth.user.id)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (!business) return json({ error: 'business not found' }, 404);
  // Язык — тот, на котором клиент сейчас пользуется приложением, иначе язык из профиля.
  const language = ['ru', 'hy', 'en'].includes(body.language)
    ? body.language
    : ['ru', 'hy', 'en'].includes(profile.language)
      ? profile.language
      : 'ru';
  const admin = adminClient();

  if (body.mode === 'welcome') {
    const { data: existing } = await admin
      .from('welcome_kits')
      .select('status')
      .eq('client_id', auth.user.id)
      .maybeSingle();
    if (existing && existing.status !== 'failed') return json({ status: existing.status });
    // Не получилось в прошлый раз (например, AI был недоступен) — можно повторить.
    if (existing) await admin.from('welcome_kits').delete().eq('client_id', auth.user.id).eq('status', 'failed');
    const { error } = await admin
      .from('welcome_kits')
      .insert({ business_id: business.id, client_id: auth.user.id, language });
    // Второй вызов в ту же секунду упрётся в уникальность — работа уже идёт.
    if (error) return json({ status: 'running' });
    background(makeWelcome(business, auth.user.id, language));
    return json({ status: 'running' });
  }

  if (!business.onboarded_at) return json({ error: 'onboarding not finished' }, 400);
  const week = weekStart();
  const { error } = await admin.from('idea_batches').insert({ business_id: business.id, week_start: week });
  if (error) return json({ week_start: week, started: false });
  background(makeIdeas(db, business, week, language));
  return json({ week_start: week, started: true });
});
