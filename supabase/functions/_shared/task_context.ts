// Контекст задачи для AI: бизнес клиента, заказ, бриф, версии, решения клиента, комментарии.
// Читается от имени пользователя — RLS отдаёт только то, что ему можно видеть.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const TASK_STATUS_EN: Record<string, string> = {
  new: 'not assigned yet',
  assigned: 'assigned, not started',
  in_progress: 'in progress',
  internal_review: 'submitted, waiting for manager review',
  client_review: 'waiting for client approval',
  changes_requested: 'changes requested — needs rework',
  approved: 'approved by client',
  publishing: 'ready to publish',
  published: 'published',
};

// deno-lint-ignore no-explicit-any
export const nameOf = (service: any) => service?.name?.en ?? service?.name?.ru ?? '';

export async function loadTaskContext(db: SupabaseClient, taskId: string) {
  const { data: task } = await db
    .from('tasks')
    .select('id, number, status, due_date, brief, order_id, service_id, assignee_id, services(name), platforms(name), businesses(*), orders(notes)')
    .eq('id', taskId)
    .maybeSingle();
  if (!task) return null;

  const [itemsRes, versionsRes, commentsRes, approvalsRes] = await Promise.all([
    db.from('order_items').select('quantity, services(name), platforms(name)').eq('order_id', task.order_id),
    db.from('deliverables').select('version, caption, files').eq('task_id', taskId).order('version', { ascending: false }).limit(3),
    db.from('task_comments').select('body, created_at').eq('task_id', taskId).order('created_at').limit(30),
    db
      .from('approvals')
      .select('decision, comment, created_at, approval_marks(position, note)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  // deno-lint-ignore no-explicit-any
  const b = (task.businesses ?? {}) as any;
  const businessLines = [
    ['Name', b.name],
    ['Industry', b.industry],
    ['City', b.city],
    ['About', b.description],
    ['Customers', b.target_audience],
    ['Tone of voice', b.tone],
    ['Goals', b.goals],
    ['Competitors / references', b.competitors],
    ['Instagram', b.instagram_url],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`)
    .join('\n');
  const versions = (versionsRes.data ?? []).map(
    (v) => `- v${v.version}: ${(v.files ?? []).length} file(s)${v.caption ? `, caption: ${String(v.caption).slice(0, 500)}` : ''}`,
  );
  const approvals = (approvalsRes.data ?? []).map((a) => {
    const marks = (a.approval_marks ?? []).map((m: { position: number; note: string }) => `point ${m.position}: ${m.note}`);
    return `- ${a.created_at.slice(0, 10)} ${a.decision}${a.comment ? `: ${a.comment}` : ''}${marks.length ? ` (${marks.join('; ')})` : ''}`;
  });
  // deno-lint-ignore no-explicit-any
  const t = task as any;

  const text = [
    `## Client business\n${businessLines}`,
    `## Order\n${(itemsRes.data ?? [])
      // deno-lint-ignore no-explicit-any
      .map((i: any) => `- ${i.platforms?.name ? `${i.platforms.name} ` : ''}${nameOf(i.services)} × ${i.quantity}`)
      .join('\n')}`,
    t.orders?.notes ? `## Client notes for the order\n${t.orders.notes}` : '',
    `## This task\n${t.platforms?.name ? `${t.platforms.name} ` : ''}${nameOf(t.services)} #${t.number}, ` +
      `${TASK_STATUS_EN[t.status] ?? t.status}${t.due_date ? `, due ${t.due_date}` : ''}`,
    `## Manager brief\n${t.brief || '(empty)'}`,
    versions.length ? `## Submitted versions (newest first)\n${versions.join('\n')}` : '',
    approvals.length ? `## Client decisions (newest first)\n${approvals.join('\n')}` : '',
    (commentsRes.data ?? []).length
      ? `## Team comments\n${(commentsRes.data ?? []).map((c) => `- ${c.body}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { task: t, text };
}
