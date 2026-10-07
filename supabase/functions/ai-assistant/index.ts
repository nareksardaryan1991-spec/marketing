// AI-помощник сотрудника. Тело: { mode: 'my_day' | 'task', language, task_id?, question? }
// «Мой день» — план работы по своим задачам; «task» — разбор задачи или ответ на вопрос по ней.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { askClaude } from '../_shared/claude.ts';
import { corsHeaders, json } from '../_shared/http.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';
import { loadTaskContext, TASK_STATUS_EN, taskName } from '../_shared/task_context.ts';

import {
  languageName,
  MY_DAY_SYSTEM,
  ROLE_EN,
  TASK_SYSTEM,
  TEAM_TASK_SYSTEM,
  type AssistantLanguage,
  type AssistantMode,
} from './prompts.ts';

const OPEN_STATUSES = ['assigned', 'in_progress', 'changes_requested', 'internal_review'];
const UNFINISHED = ['new', 'assigned', 'in_progress', 'internal_review', 'changes_requested', 'client_review'];
const TASK_FIELDS =
  'id, kind, title, priority, number, status, due_date, brief, assignee_id, services(name), platforms(name), businesses(name)';

// deno-lint-ignore no-explicit-any
function taskLine(t: any, today: string, people: Record<string, string> = {}) {
  const due = t.due_date ? (t.due_date < today ? `OVERDUE since ${t.due_date}` : `due ${t.due_date}`) : 'no due date';
  const who = t.assignee_id && people[t.assignee_id] ? `, assignee: ${people[t.assignee_id]}` : '';
  const brief = t.brief ? `\n  brief: ${String(t.brief).slice(0, 300)}` : '\n  brief: (empty)';
  return (
    `- ${t.businesses?.name ?? ''} — ${taskName(t)}: ` +
    `${TASK_STATUS_EN[t.status] ?? t.status}, ${due}${who}${brief}`
  );
}

async function myDayPrompt(db: SupabaseClient, userId: string, isManager: boolean, today: string) {
  const own = await db
    .from('tasks')
    .select(TASK_FIELDS)
    .eq('assignee_id', userId)
    .in('status', OPEN_STATUSES)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(40);
  const ownTasks = own.data ?? [];

  // Последние правки клиента по своим задачам на доработке.
  const reworkIds = ownTasks.filter((t) => t.status === 'changes_requested').map((t) => t.id);
  const feedback = reworkIds.length
    ? (
        await db
          .from('approvals')
          .select('task_id, comment, approval_marks(note)')
          .in('task_id', reworkIds)
          .eq('decision', 'changes_requested')
          .order('created_at', { ascending: false })
      ).data ?? []
    : [];
  const feedbackLines = feedback
    // deno-lint-ignore no-explicit-any
    .filter((a: any, i, all) => all.findIndex((b: any) => b.task_id === a.task_id) === i)
    // deno-lint-ignore no-explicit-any
    .map((a: any) => {
      // deno-lint-ignore no-explicit-any
      const task = ownTasks.find((t) => t.id === a.task_id) as any;
      const notes = (a.approval_marks ?? []).map((m: { note: string }) => m.note);
      return `- ${task ? taskName(task) : ''} ${task?.businesses?.name ?? ''}: ${[a.comment, ...notes].filter(Boolean).join('; ')}`;
    });

  const parts = [
    `## Today: ${today}`,
    `## My tasks\n${ownTasks.map((t) => taskLine(t, today)).join('\n') || '(none)'}`,
    feedbackLines.length ? `## Latest client change requests\n${feedbackLines.join('\n')}` : '',
  ];

  if (isManager) {
    const team = await db
      .from('tasks')
      .select(TASK_FIELDS)
      .in('status', UNFINISHED)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(80);
    const teamTasks = (team.data ?? []).filter((t) => t.assignee_id !== userId);
    const ids = [...new Set(teamTasks.map((t) => t.assignee_id).filter(Boolean))] as string[];
    const people = ids.length
      ? Object.fromEntries(
          ((await db.from('profiles').select('id, full_name, email, role').in('id', ids)).data ?? []).map((p) => [
            p.id,
            `${p.full_name || p.email} (${p.role})`,
          ]),
        )
      : {};
    parts.push(`## Team tasks (not mine)\n${teamTasks.map((t) => taskLine(t, today, people)).join('\n') || '(none)'}`);
  }

  return parts.filter(Boolean).join('\n\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = await userClient(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const mode = body.mode as AssistantMode;
  const language = (['ru', 'hy', 'en'].includes(body.language) ? body.language : 'ru') as AssistantLanguage;
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 1000) || null : null;
  if (mode !== 'my_day' && mode !== 'task') return json({ error: 'bad request' }, 400);

  // Всё читаем от имени пользователя: помощник видит ровно то, что и сам сотрудник.
  const db = auth.client;
  const { data: profile } = await db.from('profiles').select('role, full_name, job_title').eq('id', auth.user.id).single();
  const role = profile?.role as string | undefined;
  if (!role || role === 'client' || role === 'pending') return json({ error: 'forbidden' }, 403);
  const isManager = role === 'manager' || role === 'admin';

  let prompt: string | null;
  let taskId: string | null = null;
  let teamTask = false;
  if (mode === 'my_day') {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Yerevan' });
    prompt = await myDayPrompt(db, auth.user.id, isManager, today);
  } else {
    if (typeof body.task_id !== 'string') return json({ error: 'bad request' }, 400);
    const { data: canWork } = await db.rpc('can_work_on_task', { p_task_id: body.task_id });
    const context = canWork ? await loadTaskContext(db, body.task_id) : null;
    prompt = context
      ? `${context.text}\n\n${question ? `## Employee's question\n${question}` : '## No question — give the standard task breakdown.'}`
      : null;
    if (!prompt) return json({ error: 'task not found' }, 404);
    taskId = body.task_id;
    teamTask = context?.task.kind === 'team';
  }

  const who = `## Employee\n${profile?.full_name || 'Employee'}, role: ${ROLE_EN[role] ?? role}${profile?.job_title ? `, job title: ${profile.job_title}` : ''}`;
  const result = await askClaude(
    mode === 'my_day' ? MY_DAY_SYSTEM : teamTask ? TEAM_TASK_SYSTEM : TASK_SYSTEM,
    `${who}\n\n${prompt}\n\nAnswer in ${languageName(language)}.`,
  );
  if (!result.ok) return result.response;

  await adminClient().from('ai_generations').insert({
    task_id: taskId,
    kind: mode === 'my_day' ? 'assistant_day' : 'assistant_task',
    language,
    instructions: question,
    output: result.text,
    model: result.model,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    created_by: auth.user.id,
  });

  return json({ text: result.text, truncated: result.truncated });
});
