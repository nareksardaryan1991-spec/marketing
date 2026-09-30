// AI-подсказка ответа клиенту в чате заказа (только для команды). Тело: { order_id }
import { askClaude } from '../_shared/claude.ts';
import { corsHeaders, json } from '../_shared/http.ts';
import { adminClient, userClient } from '../_shared/supabase.ts';

const SYSTEM_PROMPT = `You help account managers at a social media marketing agency in Armenia reply to clients.
Draft the manager's next reply in the chat. The manager will review and edit it before sending.

Reply in the language the client writes in. Be warm, brief and concrete, like a real person in a messenger — no formal letter structure.
Use the order status below to answer questions about progress. Never promise dates, prices or discounts that are not in the context; if the client asks for something you cannot confirm, say the team will check and get back.
Return only the reply text.`;

const TASK_STATUS_EN: Record<string, string> = {
  new: 'not started',
  assigned: 'assigned to a team member',
  in_progress: 'in progress',
  internal_review: 'being reviewed internally',
  client_review: 'waiting for client approval',
  changes_requested: 'client requested changes',
  approved: 'approved by client',
  publishing: 'being published',
  published: 'published',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = await userClient(req);
  if (!auth) return json({ error: 'unauthorized' }, 401);

  const { order_id } = await req.json().catch(() => ({}));
  if (typeof order_id !== 'string') return json({ error: 'bad request' }, 400);

  const db = auth.client;
  const { data: isTeam } = await db.rpc('is_team');
  if (!isTeam) return json({ error: 'forbidden' }, 403);

  const [orderRes, messagesRes, tasksRes] = await Promise.all([
    db.from('orders').select('status, notes, businesses(name, industry, tone)').eq('id', order_id).single(),
    db
      .from('messages')
      .select('from_client, author_name, body, created_at')
      .eq('order_id', order_id)
      .order('created_at', { ascending: false })
      .limit(30),
    db.from('tasks').select('number, status, due_date, services(name), platforms(name)').eq('order_id', order_id),
  ]);
  if (!orderRes.data) return json({ error: 'order not found' }, 404);
  const history = (messagesRes.data ?? []).reverse();
  if (!history.some((m) => m.from_client)) return json({ error: 'no client messages yet' }, 400);

  // deno-lint-ignore no-explicit-any
  const business = orderRes.data.businesses as any;
  const tasks = (tasksRes.data ?? [])
    .map(
      // deno-lint-ignore no-explicit-any
      (t: any) =>
        `- ${t.platforms?.name ? `${t.platforms.name} ` : ''}${t.services?.name?.en ?? ''} #${t.number}: ${TASK_STATUS_EN[t.status] ?? t.status}` +
        (t.due_date ? `, due ${t.due_date}` : ''),
    )
    .join('\n');
  const chat = history
    .map((m) => `${m.from_client ? 'CLIENT' : 'TEAM'} (${m.author_name}): ${m.body}`)
    .join('\n');

  const prompt = [
    `## Client business\n${business?.name ?? ''}, ${business?.industry ?? ''}. Tone: ${business?.tone ?? 'not specified'}`,
    `## Order status: ${orderRes.data.status}`,
    orderRes.data.notes ? `## Client notes\n${orderRes.data.notes}` : '',
    tasks ? `## Tasks\n${tasks}` : '',
    `## Chat (oldest first)\n${chat}`,
    '## Write the next TEAM reply.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await askClaude(SYSTEM_PROMPT, prompt);
  if (!result.ok) return result.response;

  await adminClient().from('ai_generations').insert({
    order_id,
    kind: 'chat_reply',
    language: 'auto',
    output: result.text,
    model: result.model,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    created_by: auth.user.id,
  });

  return json({ text: result.text });
});
