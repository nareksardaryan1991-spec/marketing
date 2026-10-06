// AI-агент по роли. Три режима (поле mode):
// - 'request' (чат с агентом): { agent, prompt } — сотрудник пишет «сделай…», агент сразу делает
//   и отвечает в чате (текст, картинки в бакете agent-files);
// - 'attach': { run_id, task_id } — результат из чата становится версией задачи на проверке;
// - по задаче (по умолчанию): { agent, task_id | order_id, instructions?, language? } — агент делает
//   версию и отправляет менеджеру на проверку; менеджер-агент готовит план по заказу.
// Запуски работают в фоне: функция сразу отвечает { run_id }, приложение опрашивает agent_runs.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { brandColors, businessProfile } from '../_shared/business.ts';
import { askClaude } from '../_shared/claude.ts';
import { corsHeaders, json } from '../_shared/http.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';
import { loadTaskContext, nameOf } from '../_shared/task_context.ts';

import {
  AGENT_IDS,
  AGENT_NAME_EN,
  agentSchema,
  agentSystem,
  MANAGER_SYSTEM,
  requestSchema,
  requestSystem,
  type AgentId,
  type AgentOutput,
  type ManagerPlan,
  type RequestOutput,
} from './agents.ts';
import { type Brand, generateBackground, hasImageGenerator, layoutSvg, NO_BRAND, renderPng, type Format } from './image.ts';

// Сколько запусков в день можно одному человеку — защита от лишних расходов.
const DAILY_LIMIT = 30;
const LANGUAGE_NAMES: Record<string, string> = { ru: 'Russian', hy: 'Armenian', en: 'English' };
const WORKABLE = ['new', 'assigned', 'in_progress', 'changes_requested'];
const UNFINISHED = ['new', 'assigned', 'in_progress', 'internal_review', 'changes_requested', 'client_review'];

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

// Ошибка из askClaude приходит готовым HTTP-ответом — достаём текст для журнала.
async function claudeError(response: Response) {
  const body = await response.json().catch(() => null);
  return body?.error ?? `AI error ${response.status}`;
}

type Run = { id: string; userId: string; agent: AgentId; language: string; instructions: string | null };

// Бренд клиента для картинок дизайнера: логотип читаем из bucket brand (если не вышло — без него).
// deno-lint-ignore no-explicit-any
async function loadBrand(business: any): Promise<Brand> {
  let logo: Uint8Array | null = null;
  if (business?.logo_path) {
    const { data } = await adminClient().storage.from('brand').download(business.logo_path);
    if (data) logo = new Uint8Array(await data.arrayBuffer());
  }
  return { name: business?.name ?? '', colors: brandColors(business), logo };
}

async function runTaskAgent(run: Run, db: SupabaseClient, taskId: string) {
  const admin = adminClient();
  const context = await loadTaskContext(db, taskId);
  if (!context) throw new Error('task not found');
  const agent = run.agent as Exclude<AgentId, 'manager'>;

  const prompt = [
    context.text,
    run.instructions ? `## Instructions from the employee\n${run.instructions}` : '',
    `## Output language\nWrite "caption", "headline", "subline" and "note" in ${LANGUAGE_NAMES[run.language]}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const result = await askClaude(agentSystem(agent), prompt, agentSchema(agent));
  if (!result.ok) throw new Error(await claudeError(result.response));
  const output = JSON.parse(result.text) as AgentOutput;

  // Дизайнер: фон от генератора (или градиент без ключа) + макет с текстом → PNG в папку задачи.
  const files: string[] = [];
  let generated = 0;
  if (agent === 'designer') {
    const format: Format = context.task.service_id === 'story' ? 'story' : 'feed';
    const images = (output.images ?? []).slice(0, format === 'story' ? 1 : 3);
    const brand = await loadBrand(context.task.businesses);
    for (const [i, image] of images.entries()) {
      const background = await generateBackground(image.image_prompt, format);
      if (background) generated++;
      const png = await renderPng(await layoutSvg(image, brand, format, background));
      const path = `${taskId}/ai-${run.id.slice(0, 8)}-${i + 1}.png`;
      const { error } = await admin.storage.from('deliverables').upload(path, png, { contentType: 'image/png' });
      if (error) throw new Error(`upload: ${error.message}`);
      files.push(path);
    }
  }

  const { data: deliverableId, error } = await admin.rpc('submit_agent_deliverable', {
    p_task_id: taskId,
    p_by: run.userId,
    p_agent: agent,
    p_caption: output.caption,
    p_files: files,
    p_note: `🤖 ${AGENT_NAME_EN[agent]}: ${output.note}`,
  });
  if (error) throw new Error(error.message);

  await admin
    .from('agent_runs')
    .update({
      status: 'done',
      deliverable_id: deliverableId,
      result: agent === 'designer' ? { backgrounds: generated ? 'generated' : 'gradient' } : null,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      images: files.length,
      finished_at: new Date().toISOString(),
    })
    .eq('id', run.id);
}

// Чат с агентом: делаем ровно то, что написали, с учётом последних сообщений этого чата.
async function runRequest(run: Run, prompt: string) {
  const admin = adminClient();
  const agent = run.agent as Exclude<AgentId, 'manager'>;
  const { data: previous } = await admin
    .from('agent_runs')
    .select('instructions, result')
    .eq('created_by', run.userId)
    .eq('agent', agent)
    .eq('chat', true)
    .eq('status', 'done')
    .neq('id', run.id)
    .order('created_at', { ascending: false })
    .limit(3);
  const history = (previous ?? [])
    .reverse()
    .map((r) => `Employee: ${r.instructions}\nYou: ${(r.result as { text?: string } | null)?.text ?? ''}`)
    .join('\n\n');
  const message = [history ? `## Previous messages in this chat\n${history}` : '', `## New message\n${prompt}`]
    .filter(Boolean)
    .join('\n\n');

  const result = await askClaude(requestSystem(agent), message, requestSchema(agent));
  if (!result.ok) throw new Error(await claudeError(result.response));
  const output = JSON.parse(result.text) as RequestOutput;

  const files: string[] = [];
  let needsImageKey = false;
  if (agent === 'designer') {
    if (!hasImageGenerator()) needsImageKey = true;
    else {
      for (const [i, scene] of (output.scenes ?? []).slice(0, 3).entries()) {
        const image = await generateBackground(scene.image_prompt, scene.format);
        const design = { ...scene, text_position: 'bottom' as const };
        const png = await renderPng(await layoutSvg(design, NO_BRAND, scene.format, image));
        const path = `${run.userId}/${run.id}-${i + 1}.png`;
        const { error } = await admin.storage.from('agent-files').upload(path, png, { contentType: 'image/png' });
        if (error) throw new Error(`upload: ${error.message}`);
        files.push(path);
      }
    }
  }

  await admin
    .from('agent_runs')
    .update({
      status: 'done',
      result: { text: output.reply, caption: output.caption || null, files, needs_image_key: needsImageKey },
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      images: files.length,
      finished_at: new Date().toISOString(),
    })
    .eq('id', run.id);
}

// Результат из чата → версия задачи на проверке у менеджера (картинки копируются в папку задачи).
async function attachRun(userId: string, isManager: boolean, db: SupabaseClient, runId: string, taskId: string) {
  const admin = adminClient();
  const { data: run } = await admin.from('agent_runs').select('*').eq('id', runId).maybeSingle();
  if (!run || !(run.created_by === userId || isManager)) return json({ error: 'not found' }, 404);
  if (!run.chat || run.status !== 'done' || run.deliverable_id) {
    return json({ error: 'this result cannot be attached' }, 409);
  }
  const { data: task } = await db.from('tasks').select('id, status, assignee_id').eq('id', taskId).maybeSingle();
  if (!task || !(task.assignee_id === userId || isManager)) return json({ error: 'task not found' }, 404);
  if (!WORKABLE.includes(task.status)) return json({ error: 'task is not in progress' }, 400);

  const result = (run.result ?? {}) as { text?: string; caption?: string | null; files?: string[] };
  const files: string[] = [];
  for (const [i, path] of (result.files ?? []).entries()) {
    const { data: blob, error } = await admin.storage.from('agent-files').download(path);
    if (error || !blob) return json({ error: `file: ${error?.message ?? path}` }, 500);
    const target = `${taskId}/ai-${runId.slice(0, 8)}-${i + 1}.png`;
    const upload = await admin.storage.from('deliverables').upload(target, blob, { contentType: 'image/png' });
    if (upload.error) return json({ error: `upload: ${upload.error.message}` }, 500);
    files.push(target);
  }
  const { data: deliverableId, error } = await admin.rpc('submit_agent_deliverable', {
    p_task_id: taskId,
    p_by: userId,
    p_agent: run.agent,
    p_caption: result.caption || result.text || '',
    p_files: files,
    p_note: `🤖 ${AGENT_NAME_EN[run.agent as AgentId]}: «${run.instructions ?? ''}»`,
  });
  if (error) return json({ error: error.message }, 400);
  await admin.from('agent_runs').update({ task_id: taskId, deliverable_id: deliverableId }).eq('id', runId);
  return json({ deliverable_id: deliverableId });
}

async function runManagerAgent(run: Run, db: SupabaseClient, orderId: string) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Yerevan' });
  const [orderRes, tasksRes, teamRes, loadRes] = await Promise.all([
    db.from('orders').select('notes, billing, businesses(*)').eq('id', orderId).single(),
    db
      .from('tasks')
      .select('id, number, status, due_date, brief, assignee_id, services(name), platforms(name)')
      .eq('order_id', orderId)
      .in('status', ['new', 'assigned'])
      .order('number'),
    db.from('profiles').select('id, full_name, email, role, job_title').not('role', 'in', '(client,pending)'),
    db.from('tasks').select('assignee_id').in('status', UNFINISHED).not('assignee_id', 'is', null),
  ]);
  if (!orderRes.data) throw new Error('order not found');
  const tasks = tasksRes.data ?? [];
  if (!tasks.length) throw new Error('no tasks to plan in this order');

  const load: Record<string, number> = {};
  for (const t of loadRes.data ?? []) load[t.assignee_id!] = (load[t.assignee_id!] ?? 0) + 1;
  // deno-lint-ignore no-explicit-any
  const b = (orderRes.data.businesses ?? {}) as any;
  const prompt = [
    `## Today: ${today}`,
    businessProfile(b),
    orderRes.data.notes ? `## Client notes for the order\n${orderRes.data.notes}` : '',
    `## Tasks to plan\n${tasks
      .map(
        // deno-lint-ignore no-explicit-any
        (t: any) =>
          `- task_id ${t.id}: ${t.platforms?.name ? `${t.platforms.name} ` : ''}${nameOf(t.services)} #${t.number}` +
          `${t.due_date ? `, due ${t.due_date}` : ''}${t.brief ? `, current brief: ${t.brief}` : ''}`,
      )
      .join('\n')}`,
    `## Team\n${(teamRes.data ?? [])
      .map((p) => `- assignee_id ${p.id}: ${p.full_name || p.email}, role ${p.role}${p.job_title ? ` (${p.job_title})` : ''}, open tasks: ${load[p.id] ?? 0}`)
      .join('\n')}`,
    run.instructions ? `## Instructions from the manager\n${run.instructions}` : '',
    `## Output language\n${LANGUAGE_NAMES[run.language]}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await askClaude(MANAGER_SYSTEM, prompt, agentSchema('manager'));
  if (!result.ok) throw new Error(await claudeError(result.response));
  const plan = JSON.parse(result.text) as ManagerPlan;
  // Оставляем только задачи этого заказа и людей из команды — остальное модель могла выдумать.
  const taskIds = new Set(tasks.map((t) => t.id));
  const people = new Set((teamRes.data ?? []).map((p) => p.id));
  plan.tasks = plan.tasks
    .filter((t) => taskIds.has(t.task_id))
    .map((t) => ({
      ...t,
      assignee_id: people.has(t.assignee_id) ? t.assignee_id : '',
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(t.due_date) && t.due_date >= today ? t.due_date : '',
    }));

  await adminClient()
    .from('agent_runs')
    .update({
      status: 'done',
      result: plan,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      finished_at: new Date().toISOString(),
    })
    .eq('id', run.id);
}

// Работа идёт в фоне после ответа; ошибка записывается в запуск, чтобы её увидели в приложении.
function background(run: Run, work: Promise<void>) {
  const done = work.catch(async (e) => {
    console.error('agent failed', run.id, e);
    await adminClient()
      .from('agent_runs')
      .update({ status: 'failed', error: e instanceof Error ? e.message : String(e), finished_at: new Date().toISOString() })
      .eq('id', run.id);
  });
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(done);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = await userClient(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const mode = body.mode === 'request' || body.mode === 'attach' ? body.mode : 'task';
  const agent = body.agent as AgentId;
  if (mode !== 'attach' && !AGENT_IDS.includes(agent)) return json({ error: 'bad request' }, 400);
  const instructions =
    typeof body.instructions === 'string' ? body.instructions.trim().slice(0, 2000) || null : null;

  // Всё читаем от имени пользователя: агент видит то же, что и запустивший его сотрудник.
  const db = auth.client;
  const admin = adminClient();
  const { data: profile } = await db.from('profiles').select('role').eq('id', auth.user.id).single();
  const role = profile?.role as string | undefined;
  // У роли «Сотрудник» AI-агентов нет (как и в меню приложения).
  if (!role || role === 'client' || role === 'pending' || role === 'employee') return json({ error: 'forbidden' }, 403);
  const isManager = role === 'manager' || role === 'admin';

  if (mode === 'attach') {
    if (typeof body.run_id !== 'string' || typeof body.task_id !== 'string') return json({ error: 'bad request' }, 400);
    return await attachRun(auth.user.id, isManager, db, body.run_id, body.task_id);
  }

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count } = await admin
    .from('agent_runs')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', auth.user.id)
    .gte('created_at', since.toISOString());
  if ((count ?? 0) >= DAILY_LIMIT) return json({ error: 'daily AI agent limit reached' }, 429);

  if (mode === 'request') {
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 2000) : '';
    if (!prompt || agent === 'manager') return json({ error: 'bad request' }, 400);
    const { data: inserted, error } = await admin
      .from('agent_runs')
      .insert({ agent, chat: true, instructions: prompt, created_by: auth.user.id })
      .select('id')
      .single();
    if (error || !inserted) return json({ error: error?.message ?? 'cannot start' }, 500);
    const run: Run = { id: inserted.id, userId: auth.user.id, agent, language: 'ru', instructions: prompt };
    background(run, runRequest(run, prompt));
    return json({ run_id: run.id });
  }

  let taskId: string | null = null;
  let orderId: string | null = null;
  if (agent === 'manager') {
    if (!isManager) return json({ error: 'only managers can use the AI manager' }, 403);
    if (typeof body.order_id !== 'string') return json({ error: 'bad request' }, 400);
    orderId = body.order_id;
  } else {
    if (typeof body.task_id !== 'string') return json({ error: 'bad request' }, 400);
    const { data: task } = await db
      .from('tasks')
      .select('id, status, assignee_id, order_id')
      .eq('id', body.task_id)
      .maybeSingle();
    // Как и отправка версии вручную: исполнитель задачи или менеджер.
    if (!task || !(task.assignee_id === auth.user.id || isManager)) return json({ error: 'task not found' }, 404);
    if (!WORKABLE.includes(task.status)) return json({ error: 'task is not in progress' }, 400);
    const { count: running } = await admin
      .from('agent_runs')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', task.id)
      .eq('status', 'running');
    if (running) return json({ error: 'an AI agent is already working on this task' }, 409);
    taskId = task.id;
    orderId = task.order_id;
  }

  // Язык результата: выбранный сотрудником или язык клиента.
  let language = typeof body.language === 'string' && LANGUAGE_NAMES[body.language] ? body.language : null;
  if (!language) {
    const { data: order } = await admin.from('orders').select('profiles(language)').eq('id', orderId).single();
    // deno-lint-ignore no-explicit-any
    language = (order?.profiles as any)?.language ?? 'ru';
  }

  const { data: inserted, error } = await admin
    .from('agent_runs')
    .insert({
      task_id: taskId,
      order_id: agent === 'manager' ? orderId : null,
      agent,
      instructions,
      created_by: auth.user.id,
    })
    .select('id')
    .single();
  if (error || !inserted) return json({ error: error?.message ?? 'cannot start' }, 500);

  const run: Run = { id: inserted.id, userId: auth.user.id, agent, language: language!, instructions };
  background(run, agent === 'manager' ? runManagerAgent(run, db, orderId!) : runTaskAgent(run, db, taskId!));
  return json({ run_id: run.id });
});
