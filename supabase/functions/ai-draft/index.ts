// AI-черновик для задачи. Тело: { task_id, kind, language, instructions? }
import { askClaude } from '../_shared/claude.ts';
import { corsHeaders, json } from '../_shared/http.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';

import {
  buildUserPrompt,
  DRAFT_KINDS,
  SYSTEM_PROMPT,
  type DraftKind,
  type DraftLanguage,
} from './prompts.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = await userClient(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const kind = body.kind as DraftKind;
  const language = (['ru', 'hy', 'en'].includes(body.language) ? body.language : 'ru') as DraftLanguage;
  const instructions =
    typeof body.instructions === 'string' ? body.instructions.trim().slice(0, 2000) || null : null;
  if (typeof body.task_id !== 'string' || !DRAFT_KINDS.includes(kind)) {
    return json({ error: 'bad request' }, 400);
  }

  // Всё читаем от имени пользователя: RLS пропустит, только если он работает с задачей.
  const db = auth.client;
  const { data: task } = await db
    .from('tasks')
    .select('id, number, brief, order_id, service_id, services(name), platforms(name), businesses(*), orders(notes)')
    .eq('id', body.task_id)
    .maybeSingle();
  const { data: canWork } = await db.rpc('can_work_on_task', { p_task_id: body.task_id });
  if (!task || !canWork) return json({ error: 'task not found' }, 404);

  const [itemsRes, lastRes, commentsRes] = await Promise.all([
    db.from('order_items').select('quantity, services(name), platforms(name)').eq('order_id', task.order_id),
    db
      .from('deliverables')
      .select('caption')
      .eq('task_id', task.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('task_comments')
      .select('body')
      .eq('task_id', task.id)
      .order('created_at')
      .limit(20),
  ]);

  // deno-lint-ignore no-explicit-any
  const nameOf = (service: any) => service?.name?.en ?? service?.name?.ru ?? '';
  const userPrompt = buildUserPrompt(
    kind,
    language,
    {
      // deno-lint-ignore no-explicit-any
      business: (task.businesses ?? {}) as any,
      serviceName: nameOf(task.services) || task.service_id,
      // deno-lint-ignore no-explicit-any
      platform: (task.platforms as any)?.name ?? null,
      taskNumber: task.number,
      orderItems: (itemsRes.data ?? []).map(
        // deno-lint-ignore no-explicit-any
        (i: any) => `${i.platforms?.name ? `${i.platforms.name} ` : ''}${nameOf(i.services)} × ${i.quantity}`,
      ),
      // deno-lint-ignore no-explicit-any
      orderNotes: (task.orders as any)?.notes ?? null,
      taskBrief: task.brief,
      previousCaption: lastRes.data?.caption ?? null,
      comments: (commentsRes.data ?? []).map((c) => c.body),
    },
    instructions,
  );

  const result = await askClaude(SYSTEM_PROMPT, userPrompt);
  if (!result.ok) return result.response;

  await adminClient().from('ai_generations').insert({
    task_id: task.id,
    kind,
    language,
    instructions,
    output: result.text,
    model: result.model,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    created_by: auth.user.id,
  });

  return json({ text: result.text, truncated: result.truncated });
});
