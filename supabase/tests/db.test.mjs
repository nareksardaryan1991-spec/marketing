import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Проверка миграций и правил доступа на встроенном Postgres (PGlite).
// Схемы auth и storage из Supabase заменены минимальными заглушками.
const db = new PGlite();
const mig = fileURLToPath(new URL('../migrations/', import.meta.url));

await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.objects to authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);
for (const f of fs.readdirSync(mig).sort()) {
  await db.exec(fs.readFileSync(mig + f, 'utf8'));
  console.log('applied', f);
}

const CLIENT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const MANAGER = '33333333-3333-3333-3333-333333333333';
const ADMIN = '99999999-9999-9999-9999-999999999999';
await db.exec(`
  insert into auth.users values
    ('${CLIENT}', 'c@x', '{"full_name":"Client","language":"hy"}'),
    ('${OTHER}', 'o@x', '{}'),
    ('${MANAGER}', 'm@x', '{"full_name":"Boss"}');
  insert into auth.users values ('${ADMIN}', 'owner@x', '{"full_name":"Owner"}');
  update public.profiles set role = 'admin' where id = '${ADMIN}';
  update public.profiles set role = 'manager' where id = '${MANAGER}';
`);

async function as(user, sql, params) {
  await db.exec(`set role ${user ? 'authenticated' : 'service_role'}; select set_config('request.jwt.sub', '${user ?? ''}', false);`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role;');
  }
}
const check = (label, cond) => {
  console.log(cond ? 'PASS' : 'FAIL', label);
  if (!cond) process.exitCode = 1;
};
async function fails(label, fn) {
  try { await fn(); check(label + ' (should fail)', false); }
  catch (e) { check(label + ' -> ' + e.message, true); }
}

const p = await as(CLIENT, 'select * from profiles');
check('profile created by trigger with language hy', p.rows.length === 1 && p.rows[0].language === 'hy' && p.rows[0].role === 'client');
await fails('client cannot change own role', () => as(CLIENT, `update profiles set role='manager' where id='${CLIENT}'`));
await as(CLIENT, `update profiles set language='en' where id='${CLIENT}'`);

const b = await as(CLIENT, `insert into businesses (owner_id, name, industry) values ('${CLIENT}', 'Cafe', 'food') returning id`);
const bizId = b.rows[0].id;
await fails('cannot insert business for someone else', () => as(CLIENT, `insert into businesses (owner_id, name, industry) values ('${OTHER}', 'X', 'y')`));
check('other user sees no businesses', (await as(OTHER, 'select * from businesses')).rows.length === 0);
check('manager sees businesses', (await as(MANAGER, 'select * from businesses')).rows.length === 1);

const items = JSON.stringify([{ service_id: 'post', platform_id: 'instagram', quantity: 10 }, { service_id: 'reel', platform_id: 'instagram', quantity: 5 }, { service_id: 'story', platform_id: 'instagram', quantity: 2 }, { service_id: 'ads_management', quantity: 0 }]);
const o = await as(CLIENT, `select create_order($1, $2::jsonb, 'monthly', 'team', 50000, ' ') as id`, [bizId, items]);
const orderId = o.rows[0].id;
const order = (await as(CLIENT, 'select * from orders')).rows[0];
check(`order totals ${order.items_total_amd} + ${order.ad_budget_amd} = ${order.total_amd}`, order.items_total_amd === 10*8000 + 5*25000 + 2*4000 && order.total_amd === order.items_total_amd + 50000 && order.notes === null);
check('order items (zero qty dropped)', (await as(CLIENT, 'select * from order_items')).rows.length === 3);
await fails('other user cannot order for my business', () => as(OTHER, `select create_order($1, $2::jsonb, 'one_time', 'team')`, [bizId, items]));
await fails('empty order', () => as(CLIENT, `select create_order($1, '[]'::jsonb, 'one_time', 'team')`, [bizId]));
await fails('unknown service', () => as(CLIENT, `select create_order($1, '[{"service_id":"nope","quantity":1}]'::jsonb, 'one_time', 'team')`, [bizId]));
await fails('negative budget', () => as(CLIENT, `select create_order($1, '[{"service_id":"post","platform_id":"instagram","quantity":1}]'::jsonb, 'one_time', 'team', -5)`, [bizId]));
await fails('client cannot insert orders directly', () => as(CLIENT, `insert into orders (business_id, client_id, billing, items_total_amd, total_amd) values ('${bizId}', '${CLIENT}', 'one_time', 0, 1)`));
const again = await as(CLIENT, `select create_order($1, '[{"service_id":"post","platform_id":"instagram","quantity":1}]'::jsonb, 'one_time', 'client') as id`, [bizId]);
check('second order in same session works', !!again.rows[0].id);

const pay = await as(null, `insert into payments (order_id, provider, amount_amd) values ($1, 'test', $2) returning id`, [orderId, order.total_amd]);
const payId = pay.rows[0].id;
await fails('client cannot mark paid', () => as(CLIENT, `select mark_payment_succeeded($1, null, '{}')`, [payId]));
await as(null, `select mark_payment_succeeded($1, 'x1', '{}')`, [payId]);
await as(null, `select mark_payment_succeeded($1, 'x1', '{}')`, [payId]);
const after = (await as(CLIENT, 'select status, paid_at from orders where id=$1', [orderId])).rows[0];
check('order paid', after.status === 'paid' && after.paid_at);
const tasks = (await as(CLIENT, 'select service_id, count(*)::int n from tasks group by 1 order by 1')).rows;
check('tasks created once: ' + JSON.stringify(tasks), JSON.stringify(tasks) === JSON.stringify([{ service_id: 'post', n: 10 }, { service_id: 'reel', n: 5 }, { service_id: 'story', n: 2 }]));
check('client sees own payment', (await as(CLIENT, 'select * from payments')).rows.length === 1);
check('other sees no payments/tasks', (await as(OTHER, 'select * from payments')).rows.length === 0 && (await as(OTHER, 'select * from tasks')).rows.length === 0);
check('services readable', (await as(OTHER, 'select * from services')).rows.length === 5);
await as(CLIENT, `update services set price_amd = 1 where id='post'`);
check('client cannot change prices', (await as(null, `select price_amd from services where id='post'`)).rows[0].price_amd === 8000);

// ---- Этап 3 ----
const DESIGNER = '44444444-4444-4444-4444-444444444444';
const FREELANCER = '55555555-5555-5555-5555-555555555555';
await db.exec(`
  insert into auth.users values ('${DESIGNER}', 'd@x', '{}'), ('${FREELANCER}', 'f@x', '{}');
`);
await fails('manager cannot assign roles', () => as(MANAGER, `select set_user_role($1, 'designer')`, [DESIGNER]));
await as(ADMIN, `select set_user_role($1, 'designer')`, [DESIGNER]);
await as(ADMIN, `select set_user_role($1, 'freelancer')`, [FREELANCER]);
check('email copied to profile', (await as(MANAGER, `select email from profiles where id=$1`, [DESIGNER])).rows[0].email === 'd@x');

check('freelancer sees nothing before assignment',
  (await as(FREELANCER, 'select * from tasks')).rows.length === 0 &&
  (await as(FREELANCER, 'select * from businesses')).rows.length === 0 &&
  (await as(FREELANCER, 'select * from orders')).rows.length === 0);
check('designer (team) sees all tasks', (await as(DESIGNER, 'select * from tasks')).rows.length === 17);

const task = (await as(MANAGER, `select id from tasks where service_id='post' and number=1`)).rows[0].id;
const task2 = (await as(MANAGER, `select id from tasks where service_id='post' and number=2`)).rows[0].id;
await fails('designer cannot assign', () => as(DESIGNER, `select assign_task($1, $2)`, [task, FREELANCER]));
await fails('cannot assign to client', () => as(MANAGER, `select assign_task($1, $2)`, [task, CLIENT]));
await as(MANAGER, `select assign_task($1, $2, '2026-10-10', ' Сделать осенний пост ')`, [task, FREELANCER]);
const t1 = (await as(FREELANCER, 'select * from tasks')).rows;
check('freelancer sees only own task, status assigned, brief trimmed', t1.length === 1 && t1[0].status === 'assigned' && t1[0].brief === 'Сделать осенний пост');
check('freelancer sees business and order of own task',
  (await as(FREELANCER, 'select * from businesses')).rows.length === 1 &&
  (await as(FREELANCER, 'select * from orders')).rows.length === 1);

await fails('other user cannot start task', () => as(DESIGNER, `select start_task($1)`, [task]));
await as(FREELANCER, `select start_task($1)`, [task]);
check('order moved to in_progress', (await as(CLIENT, `select status from orders where id=$1`, [orderId])).rows[0].status === 'in_progress');

await fails('empty deliverable', () => as(FREELANCER, `select submit_deliverable($1, '  ', '{}')`, [task]));
await fails('file outside task folder', () => as(FREELANCER, `select submit_deliverable($1, 'text', array[$2 || '/x.png'])`, [task, task2]));
await fails('freelancer cannot submit to foreign task', () => as(FREELANCER, `select submit_deliverable($1, 'text')`, [task2]));

// Storage
await as(FREELANCER, `insert into storage.objects (bucket_id, name) values ('deliverables', $1)`, [task + '/photo.png']);
await fails('freelancer cannot upload into foreign task folder', () => as(FREELANCER, `insert into storage.objects (bucket_id, name) values ('deliverables', $1)`, [task2 + '/x.png']));
await fails('bad path rejected', () => as(FREELANCER, `insert into storage.objects (bucket_id, name) values ('deliverables', 'junk/x.png')`));
check('client does not see files before they are sent to them', (await as(CLIENT, `select * from storage.objects`)).rows.length === 0);
check('assignee sees own uploads', (await as(FREELANCER, `select * from storage.objects`)).rows.length === 1);
check('other user sees no files', (await as(OTHER, `select * from storage.objects`)).rows.length === 0);

await as(FREELANCER, `select submit_deliverable($1, 'Осенний пост', array[$2], 'v1')`, [task, task + '/photo.png']);
const tv1 = (await as(FREELANCER, 'select status from tasks where id=$1', [task])).rows[0];
check('task in internal_review', tv1.status === 'internal_review');
await fails('cannot submit while in review', () => as(FREELANCER, `select submit_deliverable($1, 'again')`, [task]));
await fails('freelancer cannot review', () => as(FREELANCER, `select review_task($1, true)`, [task]));
await as(MANAGER, `select review_task($1, false, 'Добавьте цену')`, [task]);
check('returned to in_progress with comment',
  (await as(FREELANCER, 'select status from tasks where id=$1', [task])).rows[0].status === 'in_progress' &&
  (await as(FREELANCER, 'select body from task_comments where task_id=$1', [task])).rows[0].body === 'Добавьте цену');
check('returned draft stays hidden from client',
  (await as(CLIENT, 'select * from deliverables where task_id=$1', [task])).rows.length === 0 &&
  (await as(CLIENT, `select * from storage.objects`)).rows.length === 0);
await as(FREELANCER, `select submit_deliverable($1, 'Осенний пост, 5000 драм', array[$2], 'цену взял из прайса')`, [task, task + '/photo.png']);
check('draft in internal review hidden from client', (await as(CLIENT, 'select * from deliverables where task_id=$1', [task])).rows.length === 0);
await as(MANAGER, `select review_task($1, true)`, [task]);
const versions = (await as(CLIENT, 'select version from deliverables where task_id=$1 order by version', [task])).rows.map(r => r.version);
check('client sees only the version sent to them, task in client_review',
  JSON.stringify(versions) === '[2]' && (await as(CLIENT, 'select status from tasks where id=$1', [task])).rows[0].status === 'client_review');
check('client sees file of the sent version', (await as(CLIENT, `select * from storage.objects`)).rows.length === 1);
const checkedBy = (await as(CLIENT, 'select reviewed_by, reviewer_name from deliverables where task_id=$1', [task])).rows[0];
check('sent version is marked as checked by a human, with the manager name',
  checkedBy.reviewed_by === MANAGER && checkedBy.reviewer_name === 'Boss');
await fails('nobody can fake the human check', () => as(CLIENT, `update deliverables set reviewer_name = 'Я' where task_id = $1 returning id`, [task]).then(r => { if (!r.rows.length) throw new Error('no rows'); }));
check('team still sees all versions', (await as(DESIGNER, 'select version from deliverables where task_id=$1', [task])).rows.length === 2);
check('client cannot read internal notes of a sent version',
  (await as(CLIENT, 'select * from deliverable_notes')).rows.length === 0 &&
  (await as(OTHER, 'select * from deliverable_notes')).rows.length === 0);
check('assignee sees notes of all versions',
  (await as(FREELANCER, 'select note from deliverable_notes where task_id=$1 order by note', [task])).rows.map(r => r.note).join('|') === 'v1|цену взял из прайса');
await fails('notes cannot be written directly', () => as(FREELANCER, `insert into deliverable_notes (deliverable_id, task_id, note) select id, task_id, 'x' from deliverables where task_id=$1 limit 1`, [task]));
check('version without a note has no note row',
  (await as(null, `select count(*)::int as n from deliverable_notes`)).rows[0].n === 2);
await fails('task_payload is not callable by users', () => as(CLIENT, `select task_payload(t) from tasks t limit 1`));
await fails('task_payload is not callable without sign-in', async () => { await db.exec('set role anon'); try { await db.query('select task_payload(null::tasks)'); } finally { await db.exec('reset role'); } });
await fails('manager_ids is not callable by users', () => as(CLIENT, 'select manager_ids()'));
check('client cannot read internal comments', (await as(CLIENT, 'select * from task_comments')).rows.length === 0);
await as(FREELANCER, `insert into task_comments (task_id, author_id, body) values ($1, $2, 'ок')`, [task, FREELANCER]);
await fails('cannot comment as someone else', () => as(FREELANCER, `insert into task_comments (task_id, author_id, body) values ($1, $2, 'x')`, [task, MANAGER]));
await fails('cannot comment on foreign task', () => as(FREELANCER, `insert into task_comments (task_id, author_id, body) values ($1, $2, 'x')`, [task2, FREELANCER]));
await as(MANAGER, `select assign_task($1, null)`, [task2]);
check('unassign keeps new', (await as(MANAGER, 'select status from tasks where id=$1', [task2])).rows[0].status === 'new');
const seen = (await as(FREELANCER, 'select role from profiles order by role')).rows.map(r => r.role);
check('freelancer sees staff profiles but not clients: ' + seen, !seen.includes('client') && seen.includes('manager'));
check('client sees only own profile', (await as(CLIENT, 'select * from profiles')).rows.length === 1);

// ---- Этап 4 ----
// К этому моменту: task — у клиента на согласовании (client_review), назначен FREELANCER.
const notes = async () => (await as(null, 'select user_id, kind, payload from notifications order by created_at')).rows;
await db.exec('delete from notifications');

await fails('other user cannot decide', () => as(OTHER, `select client_decide($1, true)`, [task]));
await fails('changes need a comment', () => as(CLIENT, `select client_decide($1, false, '  ')`, [task]));
await fails('manager cannot decide for client', () => as(MANAGER, `select client_decide($1, true)`, [task]));
await as(CLIENT, `select client_decide($1, false, 'Цена крупнее')`, [task]);
check('task changes_requested', (await as(CLIENT, 'select status from tasks where id=$1', [task])).rows[0].status === 'changes_requested');
let n = await notes();
check('client_changes notified to manager and assignee with comment: ' + n.map(x => x.kind),
  n.length === 3 && n.every(x => x.kind === 'client_changes' && x.payload.comment === 'Цена крупнее') &&
  n.some(x => x.user_id === MANAGER) && n.some(x => x.user_id === ADMIN) && n.some(x => x.user_id === FREELANCER));
check('freelancer sees client feedback', (await as(FREELANCER, 'select * from approvals')).rows.length === 1);
await fails('cannot decide twice', () => as(CLIENT, `select client_decide($1, true)`, [task]));

await db.exec('delete from notifications');
await as(FREELANCER, `select submit_deliverable($1, 'v3 крупная цена')`, [task]);
n = await notes();
check('internal_review notifies manager and admin only', n.length === 2 && n.every(x => x.kind === 'task_review' && [MANAGER, ADMIN].includes(x.user_id) && x.payload.business === 'Cafe'));
await as(MANAGER, `select review_task($1, true)`, [task]);
n = await notes();
check('client_review notifies client', n.at(-1).kind === 'client_review' && n.at(-1).user_id === CLIENT);
await as(CLIENT, `select client_decide($1, true)`, [task]);
const appr = (await as(CLIENT, 'select a.decision, d.version from approvals a join deliverables d on d.id=a.deliverable_id where a.task_id=$1 order by a.created_at', [task])).rows;
check('approval recorded for latest version: ' + JSON.stringify(appr), appr.at(-1).decision === 'approved' && appr.at(-1).version === 3);
check('task approved', (await as(CLIENT, 'select status from tasks where id=$1', [task])).rows[0].status === 'approved');

await db.exec('delete from notifications');
await as(MANAGER, `select assign_task($1, $2)`, [task2, DESIGNER]);
n = await notes();
check('assignment notifies assignee', n.length === 1 && n[0].kind === 'task_assigned' && n[0].user_id === DESIGNER);

// Чат
await db.exec('delete from notifications');
await as(CLIENT, `insert into messages (order_id, body) values ($1, '  Здравствуйте!  ')`, [orderId]);
const m = (await as(CLIENT, 'select * from messages')).rows[0];
check('message author filled, trimmed', m.author_id === CLIENT && m.author_name === 'Client' && m.from_client === true && m.body === 'Здравствуйте!');
n = await notes();
check('client message notifies manager and admin', n.length === 2 && n.every(x => x.kind === 'client_message' && [MANAGER, ADMIN].includes(x.user_id) && x.payload.preview === 'Здравствуйте!'));
await as(DESIGNER, `insert into messages (order_id, body) values ($1, 'Добрый день')`, [orderId]);
n = await notes();
check('team message notifies client', n.at(-1).kind === 'team_message' && n.at(-1).user_id === CLIENT);
check('client sees both messages', (await as(CLIENT, 'select * from messages')).rows.length === 2);
check('freelancer cannot read chat', (await as(FREELANCER, 'select * from messages')).rows.length === 0);
await fails('freelancer cannot write chat', () => as(FREELANCER, `insert into messages (order_id, body) values ($1, 'hi')`, [orderId]));
await fails('other user cannot write chat', () => as(OTHER, `insert into messages (order_id, body) values ($1, 'hi')`, [orderId]));
await fails('cannot spoof author', () => as(CLIENT, `insert into messages (order_id, author_id, body) values ($1, $2, 'x')`, [orderId, MANAGER]));
await fails('empty message', () => as(CLIENT, `insert into messages (order_id, body) values ($1, '   ')`, [orderId]));
check('client sees own notifications only', (await as(CLIENT, 'select * from notifications')).rows.every(r => r.user_id === CLIENT));

// Каналы
const code = (await as(CLIENT, 'select create_telegram_link_code() as c')).rows[0].c;
check('link code 32 hex', /^[0-9a-f]{32}$/.test(code));
await as(CLIENT, `update profiles set expo_push_token='ExponentPushToken[x]' where id=$1`, [CLIENT]);
await fails('user cannot set telegram_chat_id', () => as(CLIENT, `update profiles set telegram_chat_id=1 where id=$1`, [CLIENT]));
await fails('clients cannot call notify_users', () => as(CLIENT, `select notify_users(array[$1]::uuid[], 'x', '{}')`, [OTHER]));

// ---- Этап 5 ----
// task: approved (заказ monthly, publishing='team'), task2: назначен DESIGNER.
await db.exec('delete from notifications');
await fails('client cannot schedule in team mode', () => as(CLIENT, `select schedule_task($1, now() + interval '1 day')`, [task]));
await fails('freelancer cannot schedule', () => as(FREELANCER, `select schedule_task($1, now())`, [task]));
await as(DESIGNER, `select schedule_task($1, now() + interval '1 day')`, [task]);
check('scheduled, still approved', (await as(CLIENT, 'select status, publish_at from tasks where id=$1', [task])).rows[0].publish_at !== null);
check('nothing due yet', (await as(null, 'select process_due_publications() as n')).rows[0].n === 0);
await as(MANAGER, `select schedule_task($1, now() - interval '1 minute')`, [task]);
check('one due', (await as(null, 'select process_due_publications() as n')).rows[0].n === 1);
check('task publishing', (await as(CLIENT, 'select status from tasks where id=$1', [task])).rows[0].status === 'publishing');
let n5 = await notes();
check('publish_due to manager (no smm yet), not "client approved" again: ' + n5.map(x => x.kind),
  n5.length === 2 && n5.every(x => x.kind === 'publish_due' && [MANAGER, ADMIN].includes(x.user_id)));
await as(MANAGER, `select schedule_task($1, now() + interval '2 days')`, [task]);
check('rescheduled to future -> approved again', (await as(CLIENT, 'select status from tasks where id=$1', [task])).rows[0].status === 'approved');
check('reschedule sends no notification', (await notes()).length === 2);

await fails('cannot publish unapproved task', () => as(MANAGER, `select mark_published($1)`, [task2]));
await fails('client cannot publish in team mode', () => as(CLIENT, `select mark_published($1)`, [task]));
await as(MANAGER, `select mark_published($1, ' https://instagram.com/p/abc ')`, [task]);
const pub = (await as(CLIENT, 'select status, published_url, published_at from tasks where id=$1', [task])).rows[0];
check('published with url', pub.status === 'published' && pub.published_url === 'https://instagram.com/p/abc' && pub.published_at);
n5 = await notes();
check('client notified about publication', n5.at(-1).kind === 'task_published' && n5.at(-1).user_id === CLIENT && n5.at(-1).payload.url === 'https://instagram.com/p/abc');
await fails('cannot publish twice', () => as(MANAGER, `select mark_published($1)`, [task]));
await fails('cannot reschedule published', () => as(MANAGER, `select schedule_task($1, now())`, [task]));
check('order not completed while other tasks remain', (await as(CLIENT, 'select status from orders where id=$1', [orderId])).rows[0].status === 'in_progress');

// Режим «клиент публикует сам» — второй заказ (again) с publishing='client'
const againId = again.rows[0].id;
const payC = (await as(null, `insert into payments (order_id, provider, amount_amd) values ($1, 'test', 8000) returning id`, [againId])).rows[0].id;
await as(null, `select mark_payment_succeeded($1, 't', '{}')`, [payC]);
const ct = (await as(MANAGER, 'select id from tasks where order_id=$1', [againId])).rows[0].id;
await as(MANAGER, `select assign_task($1, $2)`, [ct, DESIGNER]);
await as(DESIGNER, `select start_task($1)`, [ct]);
await as(DESIGNER, `select submit_deliverable($1, 'пост')`, [ct]);
await as(MANAGER, `select review_task($1, true)`, [ct]);
await as(CLIENT, `select client_decide($1, true)`, [ct]);
await db.exec('delete from notifications');
await as(CLIENT, `select schedule_task($1, now() - interval '1 minute')`, [ct]);
await as(null, 'select process_due_publications()');
n5 = await notes();
check('client mode: publish_due goes to client', n5.length === 1 && n5[0].kind === 'publish_due' && n5[0].user_id === CLIENT);
await as(CLIENT, `select mark_published($1)`, [ct]);
check('client mode: no "published" notification to client', (await notes()).length === 1);
check('all tasks published -> order completed', (await as(CLIENT, 'select status from orders where id=$1', [againId])).rows[0].status === 'completed');

// Повтор заказа и продление
const rep = (await as(CLIENT, 'select repeat_order($1) as id', [orderId])).rows[0].id;
const repOrder = (await as(CLIENT, 'select * from orders where id=$1', [rep])).rows[0];
check('repeat_order copies items and totals', repOrder.status === 'pending_payment' && repOrder.total_amd === order.total_amd && repOrder.billing === 'monthly');
await fails('other user cannot repeat my order', () => as(OTHER, 'select repeat_order($1)', [orderId]));
await db.exec(`delete from orders where id='${rep}'`);
await db.exec('delete from notifications');
check('no renewal before 30 days', (await as(null, 'select process_renewals() as n')).rows[0].n === 0);
await db.exec(`update orders set paid_at = now() - interval '31 days', created_at = now() - interval '32 days' where id='${orderId}'`);
check('renewal due after 30 days', (await as(null, 'select process_renewals() as n')).rows[0].n === 1);
n5 = await notes();
check('renewal notification to client', n5.length === 1 && n5[0].kind === 'renewal_due' && n5[0].user_id === CLIENT);
check('renewal sent once', (await as(null, 'select process_renewals() as n')).rows[0].n === 0);
await fails('client cannot run cron functions', () => as(CLIENT, 'select process_renewals()'));

// ---- Автопубликация Instagram ----
await as(null, `insert into social_accounts (business_id, external_user_id, username, access_token, token_expires_at)
  values ($1, '178', 'cafe_aroma', 'SECRET-TOKEN', now() + interval '60 days')`, [bizId]);
check('client sees own account without token',
  (await as(CLIENT, 'select username from social_accounts')).rows[0].username === 'cafe_aroma');
await fails('client cannot read token', () => as(CLIENT, 'select access_token from social_accounts'));
await fails('manager cannot read token', () => as(MANAGER, 'select access_token from social_accounts'));
check('other user sees no accounts', (await as(OTHER, 'select id from social_accounts')).rows.length === 0);
await fails('client cannot insert account directly', () => as(CLIENT,
  `insert into social_accounts (business_id, external_user_id, access_token, token_expires_at) values ($1, 'x', 'y', now())`, [bizId]));
await fails('client cannot read oauth states', () => as(CLIENT, 'select * from oauth_states'));

// Авто-заказ: одна задача, доводим до publishing.
const autoOrder = (await as(CLIENT, `select create_order($1, '[{"service_id":"post","platform_id":"instagram","quantity":1}]'::jsonb, 'one_time', 'auto') as id`, [bizId])).rows[0].id;
const payA = (await as(null, `insert into payments (order_id, provider, amount_amd) values ($1, 'test', 8000) returning id`, [autoOrder])).rows[0].id;
await as(null, `select mark_payment_succeeded($1, 't', '{}')`, [payA]);
const at = (await as(MANAGER, 'select id from tasks where order_id=$1', [autoOrder])).rows[0].id;
await as(MANAGER, `select assign_task($1, $2)`, [at, DESIGNER]);
await as(DESIGNER, `select start_task($1)`, [at]);
await as(DESIGNER, `select submit_deliverable($1, 'авто', array[$2])`, [at, at + '/photo.jpg']);
await as(MANAGER, `select review_task($1, true)`, [at]);
await as(CLIENT, `select client_decide($1, true)`, [at]);
await db.exec('delete from notifications');
await as(MANAGER, `select schedule_task($1, now() - interval '1 minute')`, [at]);
await as(null, 'select process_due_publications()');
check('auto + connected account: no publish_due reminder', (await notes()).length === 0);

await fails('client cannot mark auto published', () => as(CLIENT, `select mark_auto_published($1, 'm', 'u')`, [at]));
await as(null, `select mark_auto_publish_failed($1, 'Only JPEG images are supported')`, [at]);
let na = await notes();
check('failure notifies manager and admin with error', na.length === 2 && na.every(x => x.kind === 'publish_failed' && [MANAGER, ADMIN].includes(x.user_id) && x.payload.error.includes('JPEG')));
const failed = (await as(CLIENT, 'select status, publish_error, autopublish_state from tasks where id=$1', [at])).rows[0];
check('failed task stays publishing with error', failed.status === 'publishing' && failed.publish_error.includes('JPEG') && failed.autopublish_state.failed === true);
await as(MANAGER, `select schedule_task($1, now() - interval '1 minute')`, [at]);
const retried = (await as(CLIENT, 'select publish_error, autopublish_state from tasks where id=$1', [at])).rows[0];
check('rescheduling clears error and state', retried.publish_error === null && Object.keys(retried.autopublish_state).length === 0);
await as(null, `select mark_auto_published($1, '1799', 'https://instagram.com/p/xyz')`, [at]);
const done = (await as(CLIENT, 'select t.status, t.published_url, o.status as order_status from tasks t join orders o on o.id=t.order_id where t.id=$1', [at])).rows[0];
check('auto published, order completed', done.status === 'published' && done.published_url === 'https://instagram.com/p/xyz' && done.order_status === 'completed');
na = await notes();
check('client notified about auto publication', na.at(-1).kind === 'task_published' && na.at(-1).user_id === CLIENT);
await as(null, `select mark_auto_published($1, '1799', 'x')`, [at]);
check('repeat success is a no-op', (await as(CLIENT, 'select published_url from tasks where id=$1', [at])).rows[0].published_url === 'https://instagram.com/p/xyz');

await fails('other user cannot disconnect', () => as(OTHER, 'select disconnect_social_account($1)', [bizId]));
await as(CLIENT, 'select disconnect_social_account($1)', [bizId]);
check('disconnected', (await as(null, 'select count(*)::int n from social_accounts')).rows[0].n === 0);

// ---- Вызовы Edge Functions из базы ----
// Здесь нет Vault и pg_net: вызов должен тихо пропускаться, а не ломать запись.
await as(null, `select call_edge_function('notify-dispatch', 'notify_webhook_secret', 'x-webhook-secret')`);
check('call_edge_function is a safe no-op without vault', true);
await fails('clients cannot call edge functions via db', () => as(CLIENT, `select call_edge_function('auto-publish', 'autopublish_secret', 'x')`));
await as(CLIENT, `insert into messages (order_id, body) values ($1, 'ещё вопрос')`, [orderId]);
check('notifications still written', (await as(null, `select count(*)::int n from notifications where kind='client_message'`)).rows[0].n >= 1);

// ---- Редактирование каталога и анкеты ----
await as(MANAGER, `update services set price_amd = 9000, name = '{"ru":"Пост","hy":"Գրառում","en":"Post"}' where id = 'post'`);
check('manager changes price', (await as(CLIENT, `select price_amd from services where id='post'`)).rows[0].price_amd === 9000);
await as(DESIGNER, `update services set price_amd = 1 where id = 'post'`);
check('designer cannot change price', (await as(CLIENT, `select price_amd from services where id='post'`)).rows[0].price_amd === 9000);
check('paid order keeps old unit price', (await as(CLIENT, `select unit_price_amd from order_items where order_id=$1 and service_id='post'`, [orderId])).rows[0].unit_price_amd === 8000);
await as(MANAGER, `insert into services (id, name, price_amd) values ('photo_session', '{"ru":"Фотосессия"}', 50000)`);
await fails('client cannot add services', () => as(CLIENT, `insert into services (id, name, price_amd) values ('x', '{"ru":"x"}', 1)`));
await as(MANAGER, `update services set active = false where id = 'photo_session'`);
await fails('hidden service cannot be ordered', () => as(CLIENT, `select create_order($1, '[{"service_id":"photo_session","quantity":1}]'::jsonb, 'one_time', 'team')`, [bizId]));

await as(CLIENT, `update businesses set tone = 'весёлый' where id = $1`, [bizId]);
check('client edits own business', (await as(CLIENT, 'select tone from businesses where id=$1', [bizId])).rows[0].tone === 'весёлый');
await fails('client cannot hand business to someone else', () => as(CLIENT, `update businesses set owner_id = $2 where id = $1`, [bizId, OTHER]));
await as(MANAGER, `update businesses set city = 'Гюмри' where id = $1`, [bizId]);
check('manager edits client business', (await as(CLIENT, 'select city from businesses where id=$1', [bizId])).rows[0].city === 'Гюмри');
await as(DESIGNER, `update businesses set city = 'X' where id = $1`, [bizId]);
check('designer cannot edit business', (await as(CLIENT, 'select city from businesses where id=$1', [bizId])).rows[0].city === 'Гюмри');

// ---- Отчёты ----
await as(null, `insert into account_snapshots (business_id, taken_on, followers_count, metrics_30d) values ($1, current_date, 1200, '{"reach": 5000}')`, [bizId]);
await as(null, `insert into post_metrics (task_id, business_id, media_id, metrics) values ($1, $2, '1799', '{"reach": 800, "likes": 40}')`, [at, bizId]);
check('client reads own snapshots and post metrics',
  (await as(CLIENT, 'select followers_count from account_snapshots')).rows[0].followers_count === 1200 &&
  (await as(CLIENT, 'select metrics from post_metrics')).rows[0].metrics.likes === 40);
check('team reads reports', (await as(DESIGNER, 'select * from post_metrics')).rows.length === 1);
check('other user and freelancer see nothing',
  (await as(OTHER, 'select * from account_snapshots')).rows.length === 0 &&
  (await as(FREELANCER, 'select * from post_metrics')).rows.length === 0);
await fails('client cannot write metrics', () => as(CLIENT, `insert into account_snapshots (business_id, taken_on) values ($1, current_date - 1)`, [bizId]));
await as(null, `insert into social_accounts (business_id, external_user_id, access_token, token_expires_at, insights_error) values ($1, '178', 'T', now() + interval '1 day', 'no permission')`, [bizId]);
check('client sees insights_error but not token', (await as(CLIENT, 'select insights_error from social_accounts')).rows[0].insights_error === 'no permission');
await fails('token still hidden', () => as(CLIENT, 'select access_token from social_accounts'));

// ---- Исправления по итогам проверки ----
check('freelancer reads order items of own task', (await as(FREELANCER, 'select * from order_items where order_id=$1', [orderId])).rows.length === 3);
check('freelancer cannot read other orders items', (await as(FREELANCER, 'select * from order_items where order_id=$1', [autoOrder])).rows.length === 0);

// ---- Внутренний чат команды ----
const TEAM = '00000000-0000-4000-8000-00000000c0de';
await db.exec('delete from notifications');
await as(MANAGER, `insert into team_messages (conversation_id, body) values ($1, 'Планёрка в 10:00')`, [TEAM]);
const tn = await notes();
check('team message notifies staff except author, not freelancer or client: ' + tn.map(n => n.user_id === DESIGNER ? 'designer' : n.user_id),
  tn.length === 2 && tn.every(x => [DESIGNER, ADMIN].includes(x.user_id) && x.kind === 'team_chat_message' && x.payload.channel === 'team'));
check('designer reads team chat', (await as(DESIGNER, 'select body from team_messages where conversation_id=$1', [TEAM])).rows[0].body === 'Планёрка в 10:00');
check('freelancer does not see team chat', (await as(FREELANCER, 'select * from team_messages')).rows.length === 0);
check('client does not see team chat', (await as(CLIENT, 'select * from team_messages')).rows.length === 0);
await fails('freelancer cannot post to team chat', () => as(FREELANCER, `insert into team_messages (conversation_id, body) values ($1, 'hi')`, [TEAM]));
await fails('client cannot post to team chat', () => as(CLIENT, `insert into team_messages (conversation_id, body) values ($1, 'hi')`, [TEAM]));

// Личные беседы
const dm = (await as(MANAGER, 'select open_direct_conversation($1) as id', [FREELANCER])).rows[0].id;
const dm2 = (await as(FREELANCER, 'select open_direct_conversation($1) as id', [MANAGER])).rows[0].id;
check('one conversation per pair', dm === dm2);
await fails('client cannot start team chat', () => as(CLIENT, 'select open_direct_conversation($1)', [MANAGER]));
await fails('cannot chat with a client', () => as(MANAGER, 'select open_direct_conversation($1)', [CLIENT]));
await fails('cannot chat with yourself', () => as(MANAGER, 'select open_direct_conversation($1)', [MANAGER]));
await db.exec('delete from notifications');
await as(MANAGER, `insert into team_messages (conversation_id, body) values ($1, '  Давид, как рилс?  ')`, [dm]);
const dn = await notes();
check('direct message notifies only the other member', dn.length === 1 && dn[0].user_id === FREELANCER && dn[0].payload.channel === 'direct' && dn[0].payload.author === 'Boss');
check('freelancer reads own direct chat', (await as(FREELANCER, 'select body from team_messages where conversation_id=$1', [dm])).rows[0].body === 'Давид, как рилс?');
check('designer cannot read others direct chat', (await as(DESIGNER, 'select * from team_messages where conversation_id=$1', [dm])).rows.length === 0);
await fails('designer cannot write into others direct chat', () => as(DESIGNER, `insert into team_messages (conversation_id, body) values ($1, 'x')`, [dm]));
await fails('cannot spoof author', () => as(FREELANCER, `insert into team_messages (conversation_id, author_id, body) values ($1, $2, 'x')`, [dm, MANAGER]));

// Список бесед и непрочитанные
let fl = (await as(FREELANCER, 'select * from my_conversations()')).rows;
check('freelancer list: only the direct chat, 1 unread, named after manager',
  fl.length === 1 && fl[0].kind === 'direct' && fl[0].unread === 1 && fl[0].other_name === 'Boss' && fl[0].last_body === 'Давид, как рилс?');
await as(FREELANCER, 'select mark_conversation_read($1)', [dm]);
fl = (await as(FREELANCER, 'select * from my_conversations()')).rows;
check('read resets unread', fl[0].unread === 0);
const ml = (await as(MANAGER, 'select kind, unread from my_conversations()')).rows;
check('manager list: team chat first, then direct; own messages not unread',
  ml.length === 2 && ml[0].kind === 'team' && ml.every(r => r.unread === 0));
const dl = (await as(DESIGNER, 'select kind, unread from my_conversations()')).rows;
check('designer sees team chat with 1 unread', dl.length === 1 && dl[0].kind === 'team' && dl[0].unread === 1);
await fails('designer cannot mark others chat read', () => as(DESIGNER, 'select mark_conversation_read($1)', [dm]));
check('client has no conversations', (await as(CLIENT, 'select * from my_conversations()')).rows.length === 0);

// ---- Владелец, регистрация сотрудника, площадки ----
await fails('admin cannot create a second admin', () => as(ADMIN, `select set_user_role($1, 'admin')`, [MANAGER]));
await fails('admin cannot change own role', () => as(ADMIN, `select set_user_role($1, 'manager')`, [ADMIN]));
await fails('nobody can demote the admin', () => as(ADMIN, `select set_user_role($1, 'designer')`, [ADMIN]));
check('admin is a manager for work rules', (await as(ADMIN, 'select is_manager() as m, is_team() as t')).rows[0].m === true);
await as(ADMIN, `select set_user_role($1, 'seo')`, [DESIGNER]);
check('new role seo counts as team', (await as(DESIGNER, 'select is_team() as t')).rows[0].t === true);
await as(ADMIN, `select set_user_role($1, 'designer')`, [DESIGNER]);

const STAFF_NEW = '77777777-7777-7777-7777-777777777777';
const CLIENT_NEW = '78787878-7878-7878-7878-787878787878';
await db.exec('delete from notifications');
await db.exec(`insert into auth.users values ('${STAFF_NEW}', 'worker@x', '{"full_name":"Новый","account_type":"staff"}'),
  ('${CLIENT_NEW}', 'buyer@x', '{"full_name":"Покупатель","account_type":"hacker"}')`);
check('staff signup -> pending, other values -> client',
  (await as(null, `select role from profiles where id=$1`, [STAFF_NEW])).rows[0].role === 'pending' &&
  (await as(null, `select role from profiles where id=$1`, [CLIENT_NEW])).rows[0].role === 'client');
const sn = await notes();
check('admin notified about staff signup', sn.length === 1 && sn[0].user_id === ADMIN && sn[0].kind === 'staff_signup' && sn[0].payload.email === 'worker@x');
check('pending sees no tasks, clients, or colleagues',
  (await as(STAFF_NEW, 'select * from tasks')).rows.length === 0 &&
  (await as(STAFF_NEW, 'select * from businesses')).rows.length === 0 &&
  (await as(STAFF_NEW, 'select * from profiles')).rows.length === 1);
await fails('pending cannot open team chats', () => as(STAFF_NEW, 'select open_direct_conversation($1)', [MANAGER]));
check('pending not in team chat list', (await as(STAFF_NEW, 'select * from my_conversations()')).rows.length === 0);
await fails('pending cannot be assigned tasks', () => as(MANAGER, 'select assign_task($1, $2)', [task2, STAFF_NEW]));
await as(ADMIN, `select set_user_role($1, 'photographer')`, [STAFF_NEW]);
check('after admin assigns role, employee sees colleagues', (await as(STAFF_NEW, 'select * from profiles')).rows.length > 1);

// Площадки
const pl = (await as(CLIENT, `select platform_id, service_id, price_amd from platform_services order by 1, 2`)).rows;
check('platform prices readable, facebook post differs from instagram',
  pl.find(r => r.platform_id === 'facebook' && r.service_id === 'post').price_amd === 6000 &&
  pl.find(r => r.platform_id === 'instagram' && r.service_id === 'post').price_amd === 8000);
const mixed = JSON.stringify([
  { service_id: 'post', platform_id: 'instagram', quantity: 2 },
  { service_id: 'post', platform_id: 'facebook', quantity: 3 },
  { service_id: 'reel', platform_id: 'tiktok', quantity: 1 },
  { service_id: 'video_shoot', quantity: 1 },
]);
const mo = (await as(CLIENT, `select create_order($1, $2::jsonb, 'one_time', 'auto') as id`, [bizId, mixed])).rows[0].id;
const mOrder = (await as(CLIENT, 'select total_amd from orders where id=$1', [mo])).rows[0];
check('per-platform prices summed: 2*8000 + 3*6000 + 25000 + 40000 = 99000 -> ' + mOrder.total_amd, mOrder.total_amd === 99000);
await fails('post without platform rejected', () => as(CLIENT, `select create_order($1, '[{"service_id":"post","quantity":1}]'::jsonb, 'one_time', 'team')`, [bizId]));
await fails('story on tiktok not offered', () => as(CLIENT, `select create_order($1, '[{"service_id":"story","platform_id":"tiktok","quantity":1}]'::jsonb, 'one_time', 'team')`, [bizId]));
await fails('general service with platform rejected', () => as(CLIENT, `select create_order($1, '[{"service_id":"video_shoot","platform_id":"instagram","quantity":1}]'::jsonb, 'one_time', 'team')`, [bizId]));
await fails('unknown platform rejected', () => as(CLIENT, `select create_order($1, '[{"service_id":"post","platform_id":"myspace","quantity":1}]'::jsonb, 'one_time', 'team')`, [bizId]));
const payM = (await as(null, `insert into payments (order_id, provider, amount_amd) values ($1, 'test', 99000) returning id`, [mo])).rows[0].id;
await as(null, `select mark_payment_succeeded($1, 't', '{}')`, [payM]);
const mt = (await as(CLIENT, `select coalesce(platform_id, '-') p, service_id, max(number)::int n from tasks where order_id=$1 group by 1, 2 order by 1, 2`, [mo])).rows;
check('tasks numbered per platform: ' + mt.map(r => `${r.p}/${r.service_id}:${r.n}`).join(' '),
  JSON.stringify(mt) === JSON.stringify([{ p: '-', service_id: 'video_shoot', n: 1 }, { p: 'facebook', service_id: 'post', n: 3 }, { p: 'instagram', service_id: 'post', n: 2 }, { p: 'tiktok', service_id: 'reel', n: 1 }]));
const pay2 = (await as(null, `insert into payments (order_id, provider, amount_amd) values ($1, 'test', 99000) returning id`, [mo])).rows[0].id;
await as(null, `select mark_payment_succeeded($1, 't2', '{}')`, [pay2]);
check('second payment does not duplicate tasks', (await as(CLIENT, 'select count(*)::int n from tasks where order_id=$1', [mo])).rows[0].n === 7);
const rep2 = (await as(CLIENT, 'select repeat_order($1) as id', [mo])).rows[0].id;
check('repeat keeps platforms', (await as(CLIENT, 'select total_amd from orders where id=$1', [rep2])).rows[0].total_amd === 99000);
const fbTask = (await as(MANAGER, `select * from tasks where order_id=$1 and platform_id='facebook' and number=1`, [mo])).rows[0];
check('task payload names platform', (await as(null, 'select task_payload(t) p from tasks t where id=$1', [fbTask.id])).rows[0].p.platform === 'Facebook');
await as(MANAGER, `update platform_services set price_amd = 7000 where platform_id='facebook' and service_id='post'`);
await as(CLIENT, `update platform_services set price_amd = 1 where platform_id='facebook' and service_id='post'`);
check('manager edits platform price, client cannot', (await as(CLIENT, `select price_amd from platform_services where platform_id='facebook' and service_id='post'`)).rows[0].price_amd === 7000);

// Автопубликация только для Instagram: задача Facebook в авто-заказе напоминает команде.
await as(null, `insert into social_accounts (business_id, external_user_id, access_token, token_expires_at) values ($1, '178', 'T', now() + interval '10 days') on conflict do nothing`, [bizId]);
await db.exec(`update tasks set status = 'approved', publish_at = now() - interval '1 minute' where order_id = '${mo}' and number = 1 and service_id = 'post'`);
await db.exec('delete from notifications');
await as(null, 'select process_due_publications()');
const pn = (await notes()).filter(n => n.kind === 'publish_due');
check('auto order: facebook post reminds team, instagram post does not: ' + pn.map(n => n.payload.platform).join(','),
  pn.length > 0 && pn.every(n => n.payload.platform === 'Facebook'));

// ---- Web push ----
const EP = 'https://web.push.apple.com/device-1';
await as(CLIENT, `select save_web_push_subscription($1, 'key', 'secret')`, [EP]);
check('subscription saved for client', (await as(null, 'select user_id from web_push_subscriptions where endpoint=$1', [EP])).rows[0]?.user_id === CLIENT);
await fails('user cannot read subscriptions', () => as(CLIENT, 'select * from web_push_subscriptions'));
await fails('user cannot insert subscription directly', () => as(CLIENT, `insert into web_push_subscriptions values ('https://x', $1, 'k', 'a')`, [OTHER]));
await fails('anon cannot save subscription', async () => {
  try { await db.exec(`set role anon; select save_web_push_subscription('https://x', 'k', 'a')`); }
  finally { await db.exec('reset role;'); }
});
await fails('endpoint must be https', () => as(CLIENT, `select save_web_push_subscription('http://x', 'k', 'a')`));
await as(OTHER, `select delete_web_push_subscription($1)`, [EP]);
check('other user cannot delete client subscription', (await as(null, 'select 1 from web_push_subscriptions where endpoint=$1', [EP])).rows.length === 1);
// В этом браузере вошёл другой человек — подписка переходит к нему.
await as(MANAGER, `select save_web_push_subscription($1, 'key2', 'secret2')`, [EP]);
check('same browser, new user takes over', (await as(null, 'select user_id, p256dh from web_push_subscriptions where endpoint=$1', [EP])).rows[0]?.user_id === MANAGER);
await as(MANAGER, `select delete_web_push_subscription($1)`, [EP]);
check('owner deletes own subscription', (await as(null, 'select 1 from web_push_subscriptions where endpoint=$1', [EP])).rows.length === 0);

// ---- Личный кабинет ----
await as(CLIENT, `update profiles set full_name='Anna', avatar_path=$2, cover_path=$3, accent_color='#DB2777', bio='Hi' where id=$1`,
  [CLIENT, `${CLIENT}/avatar-1.jpg`, `${CLIENT}/cover-1.jpg`]);
const cab = (await as(CLIENT, 'select * from profiles where id=$1', [CLIENT])).rows[0];
check('client edits own cabinet', cab.full_name === 'Anna' && cab.accent_color === '#DB2777' && cab.avatar_path === `${CLIENT}/avatar-1.jpg`);
await as(OTHER, `update profiles set bio='hacked' where id=$1`, [CLIENT]);
check('other user cannot edit my cabinet', (await as(null, 'select bio from profiles where id=$1', [CLIENT])).rows[0].bio === 'Hi');
await fails('accent color must be #RRGGBB', () => as(CLIENT, `update profiles set accent_color='red' where id=$1`, [CLIENT]));
await fails('bio at most 500 chars', () => as(CLIENT, `update profiles set bio=repeat('a', 501) where id=$1`, [CLIENT]));
await as(CLIENT, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${CLIENT}/avatar-1.jpg`]);
await fails('cannot upload photo into someone else folder', () => as(CLIENT, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${OTHER}/avatar-1.jpg`]));
check('everyone signed in sees photos', (await as(OTHER, `select 1 from storage.objects where bucket_id='avatars'`)).rows.length === 1);
await as(OTHER, `delete from storage.objects where bucket_id='avatars'`);
check('other user cannot delete my photo', (await as(CLIENT, `select 1 from storage.objects where bucket_id='avatars'`)).rows.length === 1);
await as(CLIENT, `delete from storage.objects where bucket_id='avatars' and name=$1`, [`${CLIENT}/avatar-1.jpg`]);
check('owner deletes own photo', (await as(CLIENT, `select 1 from storage.objects where bucket_id='avatars'`)).rows.length === 0);

// ---- Чат как в Telegram ----
const upload = (user, path) => as(user, `insert into storage.objects (bucket_id, name) values ('chat-files', $1)`, [path]);
const chatFiles = async (user) => (await as(user, `select name from storage.objects where bucket_id='chat-files'`)).rows.map(r => r.name);
const sendOrder = async (user, fields) => {
  const cols = Object.keys(fields);
  const vals = Object.values(fields).map(v => typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
  const sql = `insert into messages (order_id, ${cols.join(', ')}) values ($1, ${cols.map((c, i) => `$${i + 2}${c === 'attachments' ? '::jsonb' : ''}`).join(', ')}) returning *`;
  return (await as(user, sql, [orderId, ...vals])).rows[0];
};

// Файлы
const photo = `order/${orderId}/${CLIENT}/p1.jpg`;
await upload(CLIENT, photo);
await fails('chat file: not into someone else folder', () => upload(CLIENT, `order/${orderId}/${MANAGER}/x.jpg`));
await fails('chat file: not into foreign order chat', () => upload(OTHER, `order/${orderId}/${OTHER}/x.jpg`));
await fails('chat file: freelancer not into team chat', () => upload(FREELANCER, `team/${TEAM}/${FREELANCER}/x.jpg`));
await fails('chat file: bad path', () => upload(CLIENT, `order/${orderId}/${CLIENT}/a/b.jpg`));
check('team cannot read a file before it is sent', !(await chatFiles(DESIGNER)).includes(photo));

await db.exec('delete from notifications');
const pm = await sendOrder(CLIENT, { attachments: [{ path: photo, kind: 'photo', name: 'p1.jpg', size: 1000, width: 800, height: 600, junk: 'x' }] });
check('photo-only message, unknown fields dropped', pm.body === '' && pm.attachments.length === 1 && pm.attachments[0].junk === undefined && pm.attachments[0].width === 800);
check('photo notification preview is an icon', (await notes()).some(x => x.kind === 'client_message' && x.payload.preview === '📷'));
check('team reads the file once it is sent', (await chatFiles(DESIGNER)).includes(photo));
check('freelancer cannot read order chat file', !(await chatFiles(FREELANCER)).includes(photo));
await fails('attachment must be uploaded', () => sendOrder(CLIENT, { attachments: [{ path: `order/${orderId}/${CLIENT}/missing.jpg`, kind: 'photo' }] }));
const managerFile = `order/${orderId}/${MANAGER}/m1.pdf`;
await upload(MANAGER, managerFile);
await fails('cannot attach someone else unsent file', () => sendOrder(CLIENT, { attachments: [{ path: managerFile, kind: 'file' }] }));
await fails('unknown attachment kind', () => sendOrder(CLIENT, { attachments: [{ path: photo, kind: 'virus' }] }));
await fails('at most 10 attachments', () => sendOrder(CLIENT, { attachments: Array(11).fill({ path: photo, kind: 'photo' }) }));
await fails('text or attachment required', () => sendOrder(CLIENT, { body: '  ', attachments: [] }));

// Ответ и «Переслано от» нельзя подделать
const teamMsgId = (await as(MANAGER, 'select id from team_messages where conversation_id=$1 limit 1', [TEAM])).rows[0].id;
const reply = await sendOrder(DESIGNER, { body: 'Красивое фото', reply_to_id: pm.id });
check('reply keeps link to the message', reply.reply_to_id === pm.id);
const badReply = (await as(DESIGNER, `insert into messages (order_id, body, reply_to_id) values ($1, 'x', $2) returning id, reply_to_id`, [orderId, pm.id])).rows[0];
check('reply to same chat ok', badReply.reply_to_id === pm.id);
const crossReply = (await as(MANAGER, `insert into team_messages (conversation_id, body, reply_to_id) values ($1, 'x', $2) returning reply_to_id`, [TEAM, teamMsgId])).rows[0];
check('reply inside team chat ok', crossReply.reply_to_id === teamMsgId);
const dmReply = (await as(MANAGER, `insert into team_messages (conversation_id, body, reply_to_id) values ($1, 'x', $2) returning reply_to_id`, [dm, teamMsgId])).rows[0];
check('reply to a message of another chat is dropped', dmReply.reply_to_id === null);
check('forwarded_from cannot be set directly', (await sendOrder(CLIENT, { body: 'x', forwarded_from: 'Илон' })).forwarded_from === null);

// Правка
const own = await sendOrder(CLIENT, { body: 'Опечтака' });
await fails('only the author edits', () => as(MANAGER, `select edit_chat_message('order', $1, 'x')`, [own.id]));
await as(CLIENT, `select edit_chat_message('order', $1, '  Опечатка  ')`, [own.id]);
let ownRow = (await as(DESIGNER, 'select body, edited_at from messages where id=$1', [own.id])).rows[0];
check('author edits, everyone sees edited mark', ownRow.body === 'Опечатка' && ownRow.edited_at);
await fails('cannot edit to empty text', () => as(CLIENT, `select edit_chat_message('order', $1, '  ')`, [own.id]));
await as(CLIENT, `update messages set body = 'hack' where id = $1`, [own.id]);
check('messages cannot be updated directly', (await as(CLIENT, 'select body from messages where id=$1', [own.id])).rows[0].body === 'Опечатка');

// Удаление: у всех исчезает, оригинал видит только владелец
await fails('manager cannot delete a client message', () => as(MANAGER, `select delete_chat_message('order', $1)`, [own.id]));
await as(CLIENT, `select delete_chat_message('order', $1)`, [own.id]);
ownRow = (await as(DESIGNER, 'select body, deleted_at from messages where id=$1', [own.id])).rows[0];
check('deleted message is empty for everyone', ownRow.body === '' && ownRow.deleted_at);
check('client and manager do not see the original',
  (await as(CLIENT, 'select * from deleted_chat_messages')).rows.length === 0 &&
  (await as(MANAGER, 'select * from deleted_chat_messages')).rows.length === 0);
check('owner sees the deleted original', (await as(ADMIN, 'select body from deleted_chat_messages where message_id=$1', [own.id])).rows[0]?.body === 'Опечатка');
await fails('cannot delete twice', () => as(CLIENT, `select delete_chat_message('order', $1)`, [own.id]));
await fails('cannot edit a deleted message', () => as(CLIENT, `select edit_chat_message('order', $1, 'снова')`, [own.id]));
await as(ADMIN, `select delete_chat_message('order', $1)`, [badReply.id]);
check('owner can delete any message', !!(await as(DESIGNER, 'select deleted_at from messages where id=$1', [badReply.id])).rows[0].deleted_at);
await as(CLIENT, `select delete_chat_message('order', $1)`, [pm.id]);
check('file of a deleted message: team loses access, owner keeps it',
  !(await chatFiles(DESIGNER)).includes(photo) && (await chatFiles(ADMIN)).includes(photo));

// Пересылка
const photo2 = `order/${orderId}/${CLIENT}/p2.jpg`;
await upload(CLIENT, photo2);
const pm2 = await sendOrder(CLIENT, { body: 'Логотип', attachments: [{ path: photo2, kind: 'photo' }] });
const fwdId = (await as(MANAGER, `select forward_chat_message('order', $1, 'team', $2) as id`, [pm2.id, dm])).rows[0].id;
const fwd = (await as(FREELANCER, 'select * from team_messages where id=$1', [fwdId])).rows[0];
check('forwarded copy: text, file and original author', fwd.body === 'Логотип' && fwd.forwarded_from === 'Anna' && fwd.author_id === MANAGER && fwd.attachments[0].path === photo2);
check('recipient of a forward can open the file', (await chatFiles(FREELANCER)).includes(photo2));
await fails('client cannot forward into team chat', () => as(CLIENT, `select forward_chat_message('order', $1, 'team', $2)`, [pm2.id, TEAM]));
await fails('cannot forward a message you cannot see', () => as(FREELANCER, `select forward_chat_message('order', $1, 'team', $2)`, [pm2.id, dm]));
const fwd2 = (await as(FREELANCER, `select forward_chat_message('team', $1, 'team', $2) as id`, [fwdId, dm])).rows[0].id;
check('forward of a forward keeps the first author', (await as(MANAGER, 'select forwarded_from from team_messages where id=$1', [fwd2])).rows[0].forwarded_from === 'Anna');
check('forward flag does not leak into next insert', (await sendOrder(CLIENT, { body: 'после' })).forwarded_from === null);

// Реакции
await as(DESIGNER, `select react_to_message('order', $1, '👍')`, [pm2.id]);
await as(CLIENT, `select react_to_message('order', $1, '❤️')`, [pm2.id]);
let reacts = (await as(CLIENT, 'select user_name, emoji from chat_reactions where message_id=$1 order by emoji', [pm2.id])).rows;
check('client sees reactions with names: ' + JSON.stringify(reacts), reacts.length === 2 && reacts.some(r => r.emoji === '👍' && r.user_name === 'd@x'));
await as(DESIGNER, `select react_to_message('order', $1, '👍')`, [pm2.id]);
check('same reaction again removes it', (await as(CLIENT, 'select count(*)::int n from chat_reactions where message_id=$1', [pm2.id])).rows[0].n === 1);
await as(CLIENT, `select react_to_message('order', $1, '🔥')`, [pm2.id]);
reacts = (await as(CLIENT, 'select emoji from chat_reactions where message_id=$1', [pm2.id])).rows;
check('one reaction per person, new one replaces', reacts.length === 1 && reacts[0].emoji === '🔥');
await fails('freelancer cannot react in order chat', () => as(FREELANCER, `select react_to_message('order', $1, '👍')`, [pm2.id]));
check('outsider sees no reactions', (await as(OTHER, 'select * from chat_reactions')).rows.length === 0);
await fails('reactions cannot be inserted directly', () => as(CLIENT, `insert into chat_reactions (message_id, chat, chat_id, user_id, emoji) values ($1, 'order', $2, $3, 'x')`, [pm2.id, orderId, CLIENT]));

// Закреплённое
await as(CLIENT, `select pin_chat_message('order', $1, $2)`, [orderId, pm2.id]);
let info = (await as(DESIGNER, `select chat_info('order', $1) i`, [orderId])).rows[0].i;
check('pinned message visible to team, peer is the client', info.pinned?.id === pm2.id && info.pinned.body === 'Логотип' && info.peer.name === 'Anna');
await fails('cannot pin a message of another chat', () => as(MANAGER, `select pin_chat_message('team', $1, $2)`, [TEAM, pm2.id]));
await fails('outsider cannot pin', () => as(OTHER, `select pin_chat_message('order', $1, null)`, [orderId]));
await as(CLIENT, `select delete_chat_message('order', $1)`, [pm2.id]);
info = (await as(CLIENT, `select chat_info('order', $1) i`, [orderId])).rows[0].i;
check('deleting unpins and drops reactions',
  info.pinned === null && (await as(CLIENT, 'select count(*)::int n from chat_reactions where message_id=$1', [pm2.id])).rows[0].n === 0);
check('client sees the team, not people', info.peer.name === undefined && 'last_seen_at' in info.peer);

// Прочитано и «был в сети»
await as(DESIGNER, `select mark_chat_read('order', $1)`, [orderId]);
check('client sees that team has read', !!(await as(CLIENT, `select chat_info('order', $1) i`, [orderId])).rows[0].i.others_read_at);
check('team does not count other team members as the reader', (await as(MANAGER, `select chat_info('order', $1) i`, [orderId])).rows[0].i.others_read_at === null);
await as(CLIENT, `select mark_chat_read('order', $1)`, [orderId]);
check('team sees that the client has read', !!(await as(MANAGER, `select chat_info('order', $1) i`, [orderId])).rows[0].i.others_read_at);
await fails('freelancer cannot mark order chat read', () => as(FREELANCER, `select mark_chat_read('order', $1)`, [orderId]));
await fails('outsider gets no chat info', () => as(OTHER, `select chat_info('order', $1)`, [orderId]));
await as(CLIENT, 'select touch_last_seen()');
check('team sees when the client was online', !!(await as(MANAGER, `select chat_info('order', $1) i`, [orderId])).rows[0].i.peer.last_seen_at);
const dmInfo = (await as(FREELANCER, `select chat_info('team', $1) i`, [dm])).rows[0].i;
check('direct chat info names the colleague', dmInfo.peer.name === 'Boss' && dmInfo.peer.role === 'manager');
check('team chat info counts members', (await as(MANAGER, `select chat_info('team', $1) i`, [TEAM])).rows[0].i.members >= 3);

// Список чатов
const cl = (await as(CLIENT, 'select * from my_chats()')).rows;
check('client list: only own order chats', cl.length > 0 && cl.every(r => r.chat === 'order') && cl.some(r => r.id === orderId));
const fc = (await as(FREELANCER, 'select * from my_chats()')).rows;
check('freelancer list: only the direct chat', fc.length === 1 && fc[0].kind === 'direct' && fc[0].title === 'Boss');
const dc = (await as(DESIGNER, 'select * from my_chats()')).rows;
const dOrder = dc.find(r => r.id === orderId);
check('designer list: team chat and order chat with business and client',
  dc.some(r => r.kind === 'team') && dOrder && dOrder.title === 'Cafe' && dOrder.peer_id === CLIENT && !dc.some(r => r.id === dm));
check('list sorted by last message', dc.every((r, i) => i === 0 || !r.last_message_at || new Date(dc[i - 1].last_message_at) >= new Date(r.last_message_at)));
const mgrOrder = (await as(MANAGER, 'select * from my_chats()')).rows.find(r => r.id === orderId);
check('deleted messages are not unread; last message info present', mgrOrder.last_body === 'после' && mgrOrder.last_author_id === CLIENT);

// Фон чата
await as(CLIENT, `update profiles set chat_wallpaper='preset:mint' where id=$1`, [CLIENT]);
await as(CLIENT, `update profiles set chat_wallpaper=$2 where id=$1`, [CLIENT, `photo:${CLIENT}/wall-1.jpg`]);
check('wallpaper saved', (await as(CLIENT, 'select chat_wallpaper from profiles where id=$1', [CLIENT])).rows[0].chat_wallpaper === `photo:${CLIENT}/wall-1.jpg`);
await fails('wallpaper must be a preset or a photo path', () => as(CLIENT, `update profiles set chat_wallpaper='javascript:alert(1)' where id=$1`, [CLIENT]));

// ---- Звонки ----
const ROOM = 'marketing-abcdefghij0123456789';
await db.exec('delete from notifications');
const call = (await as(MANAGER, `insert into team_messages (conversation_id, call) values ($1, $2::jsonb) returning *`,
  [dm, JSON.stringify({ room: ROOM, video: true, url: 'https://evil.example/x' })])).rows[0];
check('call message without text, extra fields dropped', call.body === '' && call.call.room === ROOM && call.call.video === true && call.call.url === undefined);
let cn = await notes();
check('call notifies the other member as incoming_call with room',
  cn.length === 1 && cn[0].user_id === FREELANCER && cn[0].kind === 'incoming_call' && cn[0].payload.room === ROOM && cn[0].payload.video === true);
await fails('room name must be ours', () => as(MANAGER, `insert into team_messages (conversation_id, call) values ($1, $2::jsonb)`,
  [dm, JSON.stringify({ room: 'https://evil.example/x', video: false })]));
await fails('video must be true or false', () => as(MANAGER, `insert into team_messages (conversation_id, call) values ($1, $2::jsonb)`,
  [dm, JSON.stringify({ room: ROOM, video: 'yes' })]));
check('audio call by default', (await as(MANAGER, `insert into team_messages (conversation_id, call) values ($1, $2::jsonb) returning call`,
  [dm, JSON.stringify({ room: ROOM })])).rows[0].call.video === false);
check('chat list shows the last message as a call',
  (await as(FREELANCER, 'select last_attachment from my_chats() where id=$1', [dm])).rows[0].last_attachment === 'call');

await db.exec('delete from notifications');
await as(CLIENT, `insert into messages (order_id, call) values ($1, $2::jsonb)`, [orderId, JSON.stringify({ room: ROOM, video: false })]);
cn = await notes();
check('client call rings managers and owner', cn.length === 2 && cn.every(x => x.kind === 'incoming_call' && [MANAGER, ADMIN].includes(x.user_id) && x.payload.order_id === orderId));
await db.exec('delete from notifications');
const teamCall = (await as(DESIGNER, `insert into messages (order_id, call) values ($1, $2::jsonb) returning id`, [orderId, JSON.stringify({ room: ROOM, video: true })])).rows[0].id;
cn = await notes();
check('team call rings the client', cn.length === 1 && cn[0].user_id === CLIENT && cn[0].kind === 'incoming_call');
await fails('outsider cannot call into an order chat', () => as(OTHER, `insert into messages (order_id, call) values ($1, $2::jsonb)`, [orderId, JSON.stringify({ room: ROOM, video: true })]));
await as(DESIGNER, `select delete_chat_message('order', $1)`, [teamCall]);
check('deleted call has no join button', (await as(CLIENT, 'select call from messages where id=$1', [teamCall])).rows[0].call === null);

// ---- Сроки задач, панель владельца, утренняя сводка ----
await db.exec(`update tasks set due_date = null, due_reminded_on = null`);
const [tA, tB, tC, tD, tE, tF] = (await as(null, 'select id from tasks order by created_at, id limit 6')).rows.map(r => r.id);
await db.exec(`
  update tasks set status = 'in_progress', assignee_id = '${DESIGNER}', due_date = yerevan_today() + 1 where id = '${tA}';
  update tasks set status = 'assigned', assignee_id = '${FREELANCER}', due_date = yerevan_today() where id = '${tB}';
  update tasks set status = 'changes_requested', assignee_id = '${DESIGNER}', due_date = yerevan_today() - 2 where id = '${tC}';
  update tasks set status = 'new', assignee_id = null, due_date = yerevan_today() - 1 where id = '${tD}';
  update tasks set status = 'client_review', assignee_id = '${DESIGNER}', due_date = yerevan_today() - 3 where id = '${tE}';
  update tasks set status = 'in_progress', assignee_id = '${DESIGNER}', due_date = yerevan_today() + 5 where id = '${tF}';
  delete from notifications;
`);
await fails('client cannot run reminders', () => as(CLIENT, 'select process_due_reminders()'));
check('reminders sent for 4 tasks', (await as(null, 'select process_due_reminders() n')).rows[0].n === 4);
const rn = await notes();
const who = (kind) => rn.filter(x => x.kind === kind).map(x => x.user_id).sort();
check('due tomorrow → assignee', JSON.stringify(who('task_due_soon')) === JSON.stringify([DESIGNER]));
check('due today → assignee', JSON.stringify(who('task_due_today')) === JSON.stringify([FREELANCER]));
check('overdue → assignee and managers; unassigned overdue → managers only: ' + who('task_overdue').length,
  who('task_overdue').length === 5 && rn.filter(x => x.kind === 'task_overdue' && x.payload.task_id === tD).every(x => [MANAGER, ADMIN].includes(x.user_id)));
check('reminder names the task and due date', rn.every(x => x.payload.task_id && x.payload.due_date && x.payload.business));
check('client review and far deadlines are not reminded', !rn.some(x => [tE, tF].includes(x.payload.task_id)));
check('no second reminder the same day', (await as(null, 'select process_due_reminders() n')).rows[0].n === 0);

await fails('client cannot see the dashboard', () => as(CLIENT, 'select owner_dashboard()'));
await fails('designer cannot see the dashboard', () => as(DESIGNER, 'select owner_dashboard()'));
const md = (await as(MANAGER, 'select owner_dashboard() d')).rows[0].d;
check('manager dashboard hides money', md.revenue_month === null && md.revenue_prev_month === null && md.is_admin === false);
check('dashboard counts overdue open tasks: ' + md.tasks.overdue, md.tasks.overdue === 2);
const designerOpen = (await as(null, `select count(*)::int n from tasks where assignee_id = $1 and is_open_task_status(status)`, [DESIGNER])).rows[0].n;
const dRow = md.workload.find(w => w.id === DESIGNER);
check('workload per employee: designer open and overdue', dRow?.open === designerOpen && dRow.overdue === 1);
check('owner is not in the workload list', !md.workload.some(w => w.id === ADMIN));
const ad = (await as(ADMIN, 'select owner_dashboard() d')).rows[0].d;
const monthSum = (await as(null, `select coalesce(sum(amount_amd), 0)::int s from payments where status = 'succeeded'
  and updated_at >= yerevan_day_start(date_trunc('month', yerevan_today())::date)`)).rows[0].s;
check('owner sees revenue this month: ' + ad.revenue_month, ad.is_admin === true && Number(ad.revenue_month) === monthSum && monthSum > 0);
check('orders by status', Object.values(ad.orders).reduce((a, b) => a + Number(b), 0) === (await as(null, 'select count(*)::int n from orders')).rows[0].n);

await db.exec('delete from notifications');
await fails('client cannot run the digest', () => as(CLIENT, 'select process_daily_digest()'));
await as(null, 'select process_daily_digest()');
const dg = await notes();
check('digest goes to the owner only', dg.length === 1 && dg[0].user_id === ADMIN && dg[0].kind === 'daily_digest' && Number(dg[0].payload.overdue) === 2);

// ---- Согласование: «одобрить всё», точки правок, автоодобрение ----
const payOrder = async (id) => {
  const total = (await as(null, 'select total_amd from orders where id=$1', [id])).rows[0].total_amd;
  const pid = (await as(null, `insert into payments (order_id, provider, amount_amd) values ($1, 'test', $2) returning id`, [id, total])).rows[0].id;
  await as(null, `select mark_payment_succeeded($1, null, '{}')`, [pid]);
  return pid;
};
const apOrder = (await as(CLIENT, `select create_order($1, '[{"service_id":"post","platform_id":"instagram","quantity":3}]'::jsonb, 'one_time', 'team') as id`, [bizId])).rows[0].id;
await payOrder(apOrder);
const [r1, r2, r3] = (await as(null, 'select id from tasks where order_id=$1 order by number', [apOrder])).rows.map(r => r.id);
await db.exec(`
  insert into deliverables (task_id, version, caption, files, created_by)
    select id, 1, 'Пост', array[id || '/a.jpg', id || '/b.mp4'], '${DESIGNER}' from tasks where order_id = '${apOrder}';
  update tasks set status = 'client_review', assignee_id = '${DESIGNER}' where order_id = '${apOrder}';
  delete from notifications;
`);
check('sending to the client starts the response clock',
  (await as(CLIENT, 'select client_review_since from tasks where id=$1', [r1])).rows[0].client_review_since !== null);

await fails('changes need a comment or a mark', () => as(CLIENT, `select client_decide($1, false, ' ', '[]'::jsonb)`, [r1]));
await fails('mark must point to a file of the latest version', () => as(CLIENT, `select client_decide($1, false, null, $2::jsonb)`,
  [r1, JSON.stringify([{ file_path: r2 + '/a.jpg', x: 0.5, y: 0.5, note: 'тут' }])]));
await fails('mark needs a note', () => as(CLIENT, `select client_decide($1, false, null, $2::jsonb)`,
  [r1, JSON.stringify([{ file_path: r1 + '/a.jpg', x: 0.5, y: 0.5, note: ' ' }])]));
await fails('mark must be inside the picture', () => as(CLIENT, `select client_decide($1, false, null, $2::jsonb)`,
  [r1, JSON.stringify([{ file_path: r1 + '/a.jpg', x: 1.5, y: 0.5, note: 'тут' }])]));
await as(CLIENT, `select client_decide($1, false, null, $2::jsonb)`, [r1, JSON.stringify([
  { file_path: r1 + '/a.jpg', x: 0.25, y: 0.75, note: ' Логотип крупнее ' },
  { file_path: r1 + '/b.mp4', x: 0.5, y: 0.1, at_seconds: 3.5, note: 'Убрать надпись' },
])]);
const marks = (await as(DESIGNER, 'select * from approval_marks where task_id=$1 order by position', [r1])).rows;
check('changes by marks only are saved with the approval', marks.length === 2 && marks[0].note === 'Логотип крупнее' && marks[0].position === 1 && marks[1].at_seconds === 3.5 && marks[1].position === 2 &&
  (await as(CLIENT, 'select status from tasks where id=$1', [r1])).rows[0].status === 'changes_requested');
check('client sees own marks, outsider and unrelated freelancer do not',
  (await as(CLIENT, 'select * from approval_marks')).rows.length === 2 &&
  (await as(OTHER, 'select * from approval_marks')).rows.length === 0 &&
  (await as(FREELANCER, 'select * from approval_marks')).rows.length === 0);
n = await notes();
check('team is told how many marks were left', n.length > 0 && n.every(x => x.kind === 'client_changes' && x.payload.marks === 2));
await fails('client cannot add marks directly', () => as(CLIENT, `insert into approval_marks (approval_id, task_id, file_path, x, y, note)
  select id, task_id, 'x', 0, 0, 'x' from approvals where task_id = $1`, [r1]));
check('approving ignores marks', (await as(CLIENT, `select client_decide($1, true, null, $2::jsonb)`, [r2, JSON.stringify([{ file_path: 'junk', x: 0, y: 0, note: 'x' }])])) &&
  (await as(CLIENT, 'select count(*)::int n from approval_marks where task_id=$1', [r2])).rows[0].n === 0);

await db.exec(`update tasks set status = 'client_review' where id = '${r2}'`);
await fails('outsider approves nothing', () => as(OTHER, 'select client_approve_many($1)', [[r2, r3]]));
await db.exec('delete from notifications');
check('approve all: only own tasks waiting for the client',
  (await as(CLIENT, 'select client_approve_many($1) n', [[r1, r2, r3]])).rows[0].n === 2 &&
  (await as(CLIENT, `select count(*)::int n from tasks where id = any($1) and status = 'approved'`, [[r2, r3]])).rows[0].n === 2);
n = await notes();
check('approve all notifies the team about each task',
  [...new Set(n.filter(x => x.kind === 'client_approved').map(x => x.payload.task_id))].sort().join() === [r2, r3].sort().join());
await fails('nothing left to approve', () => as(CLIENT, 'select client_approve_many($1)', [[r2, r3]]));

check('settings readable by everyone', (await as(CLIENT, 'select auto_approve_days from agency_settings')).rows[0].auto_approve_days === 3);
await as(CLIENT, 'update agency_settings set auto_approve_days = 30');
await as(MANAGER, 'update agency_settings set auto_approve_days = 30');
check('only the owner changes settings', (await as(null, 'select auto_approve_days from agency_settings')).rows[0].auto_approve_days === 3);

// r1: отправлен 3 дня назад — одобряется сам; r2: вчера — напоминание; r3: только что — тишина.
await db.exec(`
  update tasks set status = 'client_review' where id in ('${r1}', '${r2}', '${r3}');
  update tasks set client_review_since = now() - interval '3 days' where id = '${r1}';
  update tasks set client_review_since = now() - interval '1 day' where id = '${r2}';
  delete from notifications;
`);
await fails('client cannot run deadlines', () => as(CLIENT, 'select process_review_deadlines()'));
check('overdue material approved automatically', (await as(null, 'select process_review_deadlines() n')).rows[0].n === 1);
const autoA = (await as(CLIENT, 'select a.auto, t.status from approvals a join tasks t on t.id = a.task_id where a.task_id=$1 order by a.created_at desc limit 1', [r1])).rows[0];
check('auto approval marked as automatic', autoA.auto === true && autoA.status === 'approved');
n = await notes();
check('team told it was approved automatically', n.some(x => x.kind === 'client_auto_approved' && x.payload.task_id === r1) && !n.some(x => x.kind === 'client_approved'));
const rem = n.filter(x => x.kind === 'client_review_reminder');
const waitingNow = (await as(CLIENT, `select count(*)::int n from tasks where status = 'client_review'`)).rows[0].n;
check('one reminder to the client about everything waiting: ' + JSON.stringify(rem.map(x => x.payload)),
  rem.length === 1 && rem[0].user_id === CLIENT && rem[0].payload.count === waitingNow && waitingNow >= 2 && /^\d\d\.\d\d$/.test(rem[0].payload.deadline));
await db.exec('delete from notifications');
await as(null, 'select process_review_deadlines()');
check('no second reminder the same day', (await notes()).length === 0);

await as(ADMIN, 'update agency_settings set auto_approve_days = 0');
await db.exec(`update tasks set client_review_since = now() - interval '30 days' where id = '${r2}'`);
check('auto approval off: nothing approved', (await as(null, 'select process_review_deadlines() n')).rows[0].n === 0 &&
  (await as(null, 'select status from tasks where id=$1', [r2])).rows[0].status === 'client_review');
await as(ADMIN, 'update agency_settings set auto_approve_days = 3');
await db.exec(`update tasks set status = 'approved' where id = '${r2}'`);
check('leaving review clears the clock', (await as(null, 'select client_review_since from tasks where id=$1', [r2])).rows[0].client_review_since === null);

// ---- Промокоды и квитанции ----
await fails('client cannot create promo codes', () => as(CLIENT, `insert into promo_codes (code, percent) values ('FREE', 50)`));
await as(ADMIN, `insert into promo_codes (code, percent, max_uses) values ('AUTUMN10', 10, 1)`);
await as(ADMIN, `insert into promo_codes (code, amount_amd, valid_until) values ('OLD', 1000, yerevan_today() - 1)`);
await as(ADMIN, `insert into promo_codes (code, amount_amd) values ('BIG', 100000)`);
await fails('code must be upper case letters and digits', () => as(ADMIN, `insert into promo_codes (code, percent) values ('a b', 5)`));
await fails('percent or amount, not both', () => as(ADMIN, `insert into promo_codes (code, percent, amount_amd) values ('BOTH', 5, 5)`));
check('client does not see the list of codes', (await as(CLIENT, 'select * from promo_codes')).rows.length === 0);
check('client checks a code (any case, spaces)', (await as(CLIENT, `select check_promo(' autumn10 ') p`)).rows[0].p.percent === 10);
await fails('expired code', () => as(CLIENT, `select check_promo('OLD')`));
await fails('unknown code', () => as(CLIENT, `select check_promo('NOPE')`));
const oneItem = '[{"service_id":"post","platform_id":"instagram","quantity":1}]';
const promoOrder = (await as(CLIENT, `select create_order($1, $2::jsonb, 'monthly', 'team', 5000, null, 'autumn10') as id`, [bizId, oneItem])).rows[0].id;
const po = (await as(CLIENT, 'select * from orders where id=$1', [promoOrder])).rows[0];
check(`discount on services only: ${po.items_total_amd} - ${po.discount_amd} + ${po.ad_budget_amd} = ${po.total_amd}`,
  po.discount_amd === 800 && po.total_amd === 8000 - 800 + 5000 && po.promo_code === 'AUTUMN10');
check('code is counted only after payment', (await as(null, `select used_count from promo_codes where code='AUTUMN10'`)).rows[0].used_count === 0);
const promoPay = await payOrder(promoOrder);
check('code counted on payment', (await as(null, `select used_count from promo_codes where code='AUTUMN10'`)).rows[0].used_count === 1);
await fails('used up code', () => as(CLIENT, `select create_order($1, $2::jsonb, 'one_time', 'team', 0, null, 'AUTUMN10')`, [bizId, oneItem]));
await fails('discount cannot make the order free', () => as(CLIENT, `select create_order($1, $2::jsonb, 'one_time', 'team', 0, null, 'BIG')`, [bizId, oneItem]));
const big = (await as(CLIENT, `select create_order($1, $2::jsonb, 'one_time', 'team', 3000, null, 'BIG') as id`, [bizId, oneItem])).rows[0].id;
check('fixed discount capped by services total', (await as(CLIENT, 'select discount_amd, total_amd from orders where id=$1', [big])).rows[0].total_amd === 3000);
const renewed = (await as(CLIENT, 'select repeat_order($1) as id', [promoOrder])).rows[0].id;
const rn2 = (await as(CLIENT, 'select * from orders where id=$1', [renewed])).rows[0];
check('repeat order goes at full price', rn2.discount_amd === 0 && rn2.promo_code === null && rn2.total_amd === 8000 + 5000);

const receipts = (await as(CLIENT, `select id, receipt_no from payments where status = 'succeeded' order by receipt_no`)).rows;
check('every paid payment has a unique receipt number, latest is the biggest',
  receipts.length >= 3 && receipts.every(r => r.receipt_no !== null) && new Set(receipts.map(r => r.receipt_no)).size === receipts.length &&
  receipts.at(-1).id === promoPay);
check('unpaid payment has no receipt', (await as(null, `select count(*)::int n from payments where status <> 'succeeded' and receipt_no is not null`)).rows[0].n === 0);

// ---------- AI-агенты ----------
const [agentTask, planTask] = (await as(null, `select id, order_id from tasks where status = 'new' order by number limit 2`)).rows;
const run = (await as(null, `insert into agent_runs (task_id, agent, created_by) values ($1, 'designer', $2) returning id`,
  [agentTask.id, MANAGER])).rows[0].id;
check('manager and team see the agent run', (await as(MANAGER, 'select * from agent_runs')).rows.length === 1 &&
  (await as(DESIGNER, 'select * from agent_runs')).rows.length === 1);
check('client, outsider and unassigned freelancer do not see agent runs',
  (await as(CLIENT, 'select * from agent_runs')).rows.length === 0 &&
  (await as(OTHER, 'select * from agent_runs')).rows.length === 0 &&
  (await as(FREELANCER, 'select * from agent_runs')).rows.length === 0);
await as(null, `insert into agent_runs (task_id, agent, created_by) values ($1, 'smm', $2)`, [agentTask.id, FREELANCER]);
check('freelancer sees only own runs', (await as(FREELANCER, 'select agent from agent_runs')).rows.map(r => r.agent).join() === 'smm');
await fails('merged agents cannot be started any more', () => as(null, `insert into agent_runs (task_id, agent, created_by) values ($1, 'copywriter', $2)`, [agentTask.id, FREELANCER]));
await fails('employee cannot write agent runs directly', () => as(MANAGER, `insert into agent_runs (task_id, agent, created_by) values ($1, 'seo', $2)`, [agentTask.id, MANAGER]));
await fails('nobody can mark own run as done', () => as(MANAGER, `update agent_runs set status = 'done' where id = $1 returning id`, [run]).then(r => { if (!r.rows.length) throw new Error('no rows'); }));
await fails('employee cannot submit as an agent', () => as(MANAGER, `select submit_agent_deliverable($1, $2, 'designer', 'x')`, [agentTask.id, MANAGER]));
await fails('agent files must be in the task folder', () => as(null, `select submit_agent_deliverable($1, $2, 'designer', 'x', array['other/a.png'])`, [agentTask.id, MANAGER]));
await as(null, `select submit_agent_deliverable($1, $2, 'designer', 'AI пост', array[$3], '🤖 AI designer: цена — заглушка')`, [agentTask.id, MANAGER, `${agentTask.id}/ai-1.png`]);
check('agent note goes to internal notes', (await as(MANAGER, 'select note from deliverable_notes where task_id = $1', [agentTask.id])).rows[0]?.note === '🤖 AI designer: цена — заглушка');
const agentDone = (await as(MANAGER, 'select status, assignee_id from tasks where id = $1', [agentTask.id])).rows[0];
const agentVersion = (await as(MANAGER, 'select agent, created_by from deliverables where task_id = $1', [agentTask.id])).rows[0];
check('agent version goes to manager review, launcher becomes responsible',
  agentDone.status === 'internal_review' && agentDone.assignee_id === MANAGER &&
  agentVersion.agent === 'designer' && agentVersion.created_by === MANAGER);
await fails('agent cannot submit a task under review', () => as(null, `select submit_agent_deliverable($1, $2, 'designer', 'again')`, [agentTask.id, MANAGER]));

const plan = JSON.stringify({ tasks: [{ task_id: planTask.id, assignee_id: DESIGNER, due_date: '2026-11-01', brief: 'AI бриф' }] });
const planRun = (await as(null, `insert into agent_runs (order_id, agent, status, result, created_by) values ($1, 'manager', 'done', $2::jsonb, $3) returning id`,
  [planTask.order_id, plan, MANAGER])).rows[0].id;
await fails('designer cannot apply the manager plan', () => as(DESIGNER, 'select apply_manager_plan($1)', [planRun]));
check('manager applies the plan', (await as(MANAGER, 'select apply_manager_plan($1) n', [planRun])).rows[0].n === 1);
const planned = (await as(MANAGER, 'select status, assignee_id, due_date::text, brief from tasks where id = $1', [planTask.id])).rows[0];
check('plan assigned the task with brief and due date',
  planned.status === 'assigned' && planned.assignee_id === DESIGNER && planned.due_date === '2026-11-01' && planned.brief === 'AI бриф');
await fails('plan cannot be applied twice', () => as(MANAGER, 'select apply_manager_plan($1)', [planRun]));

// Свободный запрос из чата с агентом — без задачи; видят автор и менеджеры.
await as(null, `insert into agent_runs (agent, chat, instructions, created_by, result) values ('designer', true, 'человек у моря', $1, '{"text":"ok","files":[]}')`, [DESIGNER]);
check('free agent request is visible to its author and managers',
  (await as(DESIGNER, `select * from agent_runs where chat`)).rows.length === 1 &&
  (await as(MANAGER, `select * from agent_runs where chat`)).rows.length === 1);
check('colleagues do not see someone else\'s free requests',
  (await as(FREELANCER, `select * from agent_runs where instructions = 'человек у моря'`)).rows.length === 0);
await db.query(`insert into storage.objects (bucket_id, name) values ('agent-files', $1), ('agent-files', $2)`,
  [`${DESIGNER}/run-1.png`, `${FREELANCER}/run-2.png`]);
const agentFolders = async (user) => (await as(user, `select name from storage.objects where bucket_id = 'agent-files' order by name`)).rows.map(r => r.name.split('/')[0]);
check('agent files: own folder only, managers see all',
  (await agentFolders(DESIGNER)).join() === DESIGNER && (await agentFolders(MANAGER)).length === 2 && (await agentFolders(CLIENT)).length === 0);

// Профиль бизнеса («мозг» агентов): примеры постов, фирменные цвета, логотип.
await as(CLIENT, `update businesses set brand_colors = '{#E5484D,#111827}', example_posts = 'Пост 1' where id = $1`, [bizId]);
check('client saves brand colors and example posts',
  (await as(CLIENT, 'select brand_colors, example_posts from businesses where id = $1', [bizId])).rows[0].brand_colors.join() === '#E5484D,#111827');
await fails('brand color must be #RRGGBB', () => as(CLIENT, `update businesses set brand_colors = '{red}' where id = $1`, [bizId]));
await fails('at most five brand colors', () => as(CLIENT,
  `update businesses set brand_colors = '{#000000,#111111,#222222,#333333,#444444,#555555}' where id = $1`, [bizId]));
await fails('logo must be in the business folder', () => as(CLIENT, `update businesses set logo_path = 'other/logo.png' where id = $1`, [bizId]));
await as(CLIENT, `insert into storage.objects (bucket_id, name) values ('brand', $1)`, [`${bizId}/logo-1.png`]);
await as(CLIENT, `update businesses set logo_path = $2 where id = $1`, [bizId, `${bizId}/logo-1.png`]);
await fails('stranger cannot upload a logo for someone else', () => as(OTHER, `insert into storage.objects (bucket_id, name) values ('brand', $1)`, [`${bizId}/logo-2.png`]));
await as(MANAGER, `insert into storage.objects (bucket_id, name) values ('brand', $1)`, [`${bizId}/logo-3.png`]);
await fails('brand files only in a business folder', () => as(MANAGER, `insert into storage.objects (bucket_id, name) values ('brand', 'junk/logo.png')`));
check('stranger does not see brand files of another business',
  (await as(OTHER, `select name from storage.objects where bucket_id = 'brand'`)).rows.length === 0 &&
  (await as(CLIENT, `select name from storage.objects where bucket_id = 'brand'`)).rows.length === 2);
await fails('stranger cannot delete a logo', () => as(OTHER, `delete from storage.objects where bucket_id = 'brand' returning name`).then(r => { if (!r.rows.length) throw new Error('nothing deleted'); }));

// Знакомство и кабинет клиента: подарок после знакомства и идеи задач от агентов.
check('a new business is not onboarded yet', (await as(CLIENT, 'select onboarded_at from businesses where id = $1', [bizId])).rows[0].onboarded_at === null);
await as(CLIENT, 'update businesses set onboarded_at = now() where id = $1', [bizId]);
check('client finishes onboarding', (await as(CLIENT, 'select onboarded_at from businesses where id = $1', [bizId])).rows[0].onboarded_at !== null);
await as(null, `insert into welcome_kits (business_id, client_id, status, result) values ($1, $2, 'done', '{"posts":[]}')`, [bizId, CLIENT]);
check('client sees own welcome kit, stranger does not',
  (await as(CLIENT, 'select * from welcome_kits')).rows.length === 1 && (await as(OTHER, 'select * from welcome_kits')).rows.length === 0);
await fails('one welcome kit per client', () => as(null, `insert into welcome_kits (business_id, client_id) values ($1, $2)`, [bizId, CLIENT]));
await fails('client cannot write a welcome kit', () => as(CLIENT, `update welcome_kits set status = 'running' returning business_id`).then(r => { if (!r.rows.length) throw new Error('no rows'); }));
await as(null, `insert into idea_batches (business_id, week_start, status) values ($1, '2026-10-05', 'done')`, [bizId]);
await fails('one idea batch per week', () => as(null, `insert into idea_batches (business_id, week_start) values ($1, '2026-10-05')`, [bizId]));
const ideaIds = (await as(null, `insert into task_ideas (business_id, week_start, agent, title, description, service_id, platform_id) values
  ($1, '2026-10-05', 'smm', 'Пост про осеннее меню', 'Тыквенный латте', 'post', 'instagram'),
  ($1, '2026-10-05', 'scriptwriter', 'Рилс с бариста', 'Латте-арт за 15 секунд', 'reel', 'instagram') returning id`, [bizId])).rows.map(r => r.id);
check('client sees ideas, stranger does not',
  (await as(CLIENT, 'select * from task_ideas')).rows.length === 2 && (await as(OTHER, 'select * from task_ideas')).rows.length === 0);
await fails('client cannot insert ideas directly', () => as(CLIENT, `insert into task_ideas (business_id, week_start, agent, title, description, service_id) values ($1, '2026-10-05', 'smm', 'x', 'y', 'post')`, [bizId]));
await fails('stranger cannot accept an idea', () => as(OTHER, 'select accept_task_idea($1)', [ideaIds[0]]));
await fails('manager cannot accept for the client', () => as(MANAGER, 'select accept_task_idea($1)', [ideaIds[0]]));
const ideaOrder = (await as(CLIENT, 'select accept_task_idea($1) as id', [ideaIds[0]])).rows[0].id;
const ideaOrderRow = (await as(CLIENT, 'select o.status, o.total_amd, o.notes, i.service_id, i.platform_id, i.quantity from orders o join order_items i on i.order_id = o.id where o.id = $1', [ideaOrder])).rows;
check('accepted idea becomes a one-item order at the catalog price waiting for payment',
  ideaOrderRow.length === 1 && ideaOrderRow[0].status === 'pending_payment' && ideaOrderRow[0].service_id === 'post' &&
  ideaOrderRow[0].platform_id === 'instagram' && ideaOrderRow[0].quantity === 1 &&
  ideaOrderRow[0].total_amd === (await as(null, `select price_amd from platform_services where platform_id = 'instagram' and service_id = 'post'`)).rows[0].price_amd &&
  ideaOrderRow[0].notes.startsWith('Пост про осеннее меню'));
check('idea remembers its order', (await as(CLIENT, 'select status, order_id from task_ideas where id = $1', [ideaIds[0]])).rows[0].order_id === ideaOrder);
await fails('idea cannot be accepted twice', () => as(CLIENT, 'select accept_task_idea($1)', [ideaIds[0]]));
await fails('stranger cannot dismiss an idea', () => as(OTHER, 'select dismiss_task_idea($1)', [ideaIds[1]]));
await as(CLIENT, 'select dismiss_task_idea($1)', [ideaIds[1]]);
check('client dismisses an idea', (await as(CLIENT, 'select status from task_ideas where id = $1', [ideaIds[1]])).rows[0].status === 'dismissed');
await fails('dismissed idea cannot be accepted', () => as(CLIENT, 'select accept_task_idea($1)', [ideaIds[1]]));

// Пакеты на месяц и валюты.
const pkgs = (await as(CLIENT, `select id, name ->> 'ru' as name, price_amd from packages order by sort_order`)).rows;
check('client sees the active monthly packages', pkgs.length === 3 && pkgs[1].name === '12 постов в месяц');
await fails('client cannot change packages', () => as(CLIENT, `update packages set price_amd = 1 returning id`).then(r => { if (!r.rows.length) throw new Error('no rows'); }));
await fails('client cannot add package items', () => as(CLIENT, `insert into package_items (package_id, service_id, platform_id, quantity) values ($1, 'reel', 'instagram', 50)`, [pkgs[0].id]));
const pkgOrderId = (await as(CLIENT, `select create_package_order($1, $2, 'team', 'с пакетом') as id`, [bizId, pkgs[1].id])).rows[0].id;
const pkgOrder = (await as(CLIENT, 'select billing, items_total_amd, discount_amd, total_amd, package_id from orders where id = $1', [pkgOrderId])).rows[0];
const pkgItems = (await as(CLIENT, `select service_id, quantity from order_items where order_id = $1 order by service_id`, [pkgOrderId])).rows;
check('package becomes a monthly order at the package price with the rest as a discount',
  pkgOrder.billing === 'monthly' && pkgOrder.total_amd === pkgs[1].price_amd && pkgOrder.package_id === pkgs[1].id &&
  pkgOrder.discount_amd === pkgOrder.items_total_amd - pkgs[1].price_amd &&
  pkgItems.map(i => `${i.service_id}:${i.quantity}`).join() === 'post:12,story:8');
await fails('stranger cannot order a package for someone else', () => as(OTHER, `select create_package_order($1, $2, 'team')`, [bizId, pkgs[1].id]));
await as(MANAGER, `update packages set price_amd = 999999 where id = $1`, [pkgs[0].id]);
const cappedId = (await as(CLIENT, `select create_package_order($1, $2, 'team') as id`, [bizId, pkgs[0].id])).rows[0].id;
const capped = (await as(CLIENT, 'select total_amd, items_total_amd from orders where id = $1', [cappedId])).rows[0];
check('package never costs more than the same services in the catalog', capped.total_amd === capped.items_total_amd);
const repeated = (await as(CLIENT, 'select repeat_order($1) as id', [pkgOrderId])).rows[0].id;
check('repeating a package order keeps the package price',
  (await as(CLIENT, 'select total_amd, package_id from orders where id = $1', [repeated])).rows[0].total_amd === pkgs[1].price_amd);
await as(MANAGER, `update packages set active = false where id = $1`, [pkgs[2].id]);
check('inactive package is hidden from clients but visible to managers',
  (await as(CLIENT, 'select id from packages')).rows.length === 2 && (await as(MANAGER, 'select id from packages')).rows.length === 3);
await fails('inactive package cannot be ordered', () => as(CLIENT, `select create_package_order($1, $2, 'team')`, [bizId, pkgs[2].id]));
await as(CLIENT, `update profiles set currency = 'USD' where id = $1`, [CLIENT]);
check('client chooses a currency', (await as(CLIENT, 'select currency from profiles where id = $1', [CLIENT])).rows[0].currency === 'USD');
await fails('only AMD, USD and EUR', () => as(CLIENT, `update profiles set currency = 'RUB' where id = $1`, [CLIENT]));
check('everyone reads exchange rates', Number((await as(CLIENT, 'select usd_rate_amd from agency_settings')).rows[0].usd_rate_amd) > 0);
await fails('client cannot change exchange rates', () => as(CLIENT, `update agency_settings set usd_rate_amd = 1 returning id`).then(r => { if (!r.rows.length) throw new Error('no rows'); }));
await as(ADMIN, `update agency_settings set usd_rate_amd = 385.5`);
check('owner sets exchange rates', Number((await as(CLIENT, 'select usd_rate_amd from agency_settings')).rows[0].usd_rate_amd) === 385.5);

// Роль «Сотрудник»: только свои задачи, без заказов и сумм, должность назначает владелец.
const EMPLOYEE = '66666666-6666-6666-6666-666666666666';
await db.exec(`insert into auth.users values ('${EMPLOYEE}', 'e@x', '{"full_name":"Emp","account_type":"staff"}')`);
await as(ADMIN, `select set_user_role($1, 'employee')`, [EMPLOYEE]);
await fails('manager cannot set a job title', () => as(MANAGER, `select set_job_title($1, 'Дизайнер')`, [EMPLOYEE]));
await fails('employee cannot set own job title', () => as(EMPLOYEE, `update profiles set job_title = 'Директор' where id = $1`, [EMPLOYEE]));
await fails('job title only for staff', () => as(ADMIN, `select set_job_title($1, 'Дизайнер')`, [CLIENT]));
await as(ADMIN, `select set_job_title($1, '  Фотограф ')`, [EMPLOYEE]);
check('owner sets the job title, colleagues see it',
  (await as(MANAGER, 'select job_title from profiles where id = $1', [EMPLOYEE])).rows[0].job_title === 'Фотограф');
check('employee sees no tasks before assignment', (await as(EMPLOYEE, 'select id from tasks')).rows.length === 0);
const empTask = (await as(MANAGER, `select id from tasks where order_id = $1 and status = 'new' and assignee_id is null order by service_id, number limit 1`, [orderId])).rows[0].id;
await as(MANAGER, `select assign_task($1, $2, null, 'Снять сторис')`, [empTask, EMPLOYEE]);
check('employee sees only own task and its business',
  (await as(EMPLOYEE, 'select id from tasks')).rows.map(r => r.id).join() === empTask &&
  (await as(EMPLOYEE, 'select id from businesses')).rows.map(r => r.id).join() === bizId);
check('employee does not see orders, their items or payments',
  (await as(EMPLOYEE, 'select id from orders')).rows.length === 0 &&
  (await as(EMPLOYEE, 'select id from order_items')).rows.length === 0 &&
  (await as(EMPLOYEE, 'select id from payments')).rows.length === 0);
check('employee reads client notes of own task only',
  (await as(EMPLOYEE, 'select task_order_notes($1) as n', [empTask])).rows[0].n === order.notes &&
  (await as(EMPLOYEE, 'select task_order_notes($1) as n', [task2])).rows[0].n === null);
await as(MANAGER, `update orders set notes = 'Без сахара' where id = $1`, [orderId]);
check('client notes come through the function',
  (await as(EMPLOYEE, 'select task_order_notes($1) as n', [empTask])).rows[0].n === 'Без сахара' &&
  (await as(CLIENT, 'select task_order_notes($1) as n', [empTask])).rows[0].n === 'Без сахара' &&
  (await as(OTHER, 'select task_order_notes($1) as n', [empTask])).rows[0].n === null);
await fails('employee cannot open the owner dashboard', () => as(EMPLOYEE, 'select owner_dashboard()'));
check('employee is not in the team chat or order chats',
  (await as(EMPLOYEE, 'select id from team_messages')).rows.length === 0 &&
  (await as(EMPLOYEE, 'select id from messages')).rows.length === 0);
check('employee sees staff profiles but not clients',
  !(await as(EMPLOYEE, 'select role from profiles')).rows.some(r => r.role === 'client'));
await as(EMPLOYEE, 'select start_task($1)', [empTask]);
await as(EMPLOYEE, `insert into storage.objects (bucket_id, name) values ('deliverables', $1)`, [empTask + '/s.jpg']);
await as(EMPLOYEE, `select submit_deliverable($1, 'Сторис готова', array[$2])`, [empTask, empTask + '/s.jpg']);
check('employee submits work for review', (await as(MANAGER, 'select status from tasks where id = $1', [empTask])).rows[0].status === 'internal_review');

// Задачи команды: поручения людям, клиент их не видит даже по своему заказу.
const teamTaskArgs = `select create_team_task($1, $2, $3, $4, $5, $6, $7) as id`;
await fails('employee cannot create team tasks', () => as(EMPLOYEE, teamTaskArgs, ['X', null, EMPLOYEE, null, 'normal', null, null]));
await fails('designer cannot create team tasks', () => as(DESIGNER, teamTaskArgs, ['X', null, EMPLOYEE, null, 'normal', null, null]));
await fails('client cannot create team tasks', () => as(CLIENT, teamTaskArgs, ['X', null, EMPLOYEE, null, 'normal', null, null]));
await fails('team task needs a title', () => as(MANAGER, teamTaskArgs, ['  ', null, EMPLOYEE, null, 'normal', null, null]));
await fails('team task cannot go to a client', () => as(MANAGER, teamTaskArgs, ['X', null, CLIENT, null, 'normal', null, null]));
await fails('unknown priority', () => as(MANAGER, teamTaskArgs, ['X', null, EMPLOYEE, null, 'whenever', null, null]));
await fails('unknown order', () => as(MANAGER, teamTaskArgs, ['X', null, EMPLOYEE, null, 'normal', null, OTHER]));
const freeTask = (await as(MANAGER, teamTaskArgs, [' Обновить шаблон сторис ', 'Новые цвета бренда', EMPLOYEE, '2026-10-20', 'high', null, null])).rows[0].id;
const spareTask = (await as(ADMIN, teamTaskArgs, ['Разобрать архив', null, null, null, 'low', null, null])).rows[0].id;
const ft = (await as(MANAGER, 'select * from tasks where id = $1', [freeTask])).rows[0];
check('team task without a client: assigned, trimmed, author kept',
  ft.kind === 'team' && ft.status === 'assigned' && ft.title === 'Обновить шаблон сторис' && ft.brief === 'Новые цвета бренда' &&
  ft.priority === 'high' && ft.created_by === MANAGER && ft.order_id === null && ft.business_id === null);
check('owner creates an unassigned team task, two tasks without an order coexist',
  (await as(ADMIN, 'select status from tasks where id = $1', [spareTask])).rows[0].status === 'new');
const linkedTask = (await as(MANAGER, teamTaskArgs, ['Снять десерты для заказа', 'Утренний свет', EMPLOYEE, '2026-10-12', 'urgent', null, orderId])).rows[0].id;
const lt = (await as(MANAGER, 'select * from tasks where id = $1', [linkedTask])).rows[0];
check('team task about an order keeps the order aside and takes its client',
  lt.order_id === null && lt.related_order_id === orderId && lt.business_id === bizId);
await fails('order and client must match', () => as(MANAGER, teamTaskArgs, ['X', null, EMPLOYEE, null, 'normal', OTHER, orderId]));

const teamIds = [freeTask, spareTask, linkedTask];
check('client does not see team tasks, even about own order',
  (await as(CLIENT, 'select id from tasks where id = any($1)', [teamIds])).rows.length === 0 &&
  (await as(CLIENT, 'select can_view_task($1) as v', [linkedTask])).rows[0].v === false);
check('employee sees only own team tasks',
  (await as(EMPLOYEE, `select id from tasks where kind = 'team' order by id`)).rows.map(r => r.id).join() === [freeTask, linkedTask].sort().join());
check('employee does not see an unassigned team task', (await as(EMPLOYEE, 'select id from tasks where id = $1', [spareTask])).rows.length === 0);
check('freelancer does not see team tasks of others', (await as(FREELANCER, `select id from tasks where kind = 'team'`)).rows.length === 0);
check('staff team does not see team tasks of others', (await as(DESIGNER, `select id from tasks where kind = 'team'`)).rows.length === 0);
check('manager sees own team tasks, not the owner task; the owner sees all',
  (await as(MANAGER, `select id from tasks where kind = 'team' order by id`)).rows.map(r => r.id).join() === [freeTask, linkedTask].sort().join() &&
  (await as(ADMIN, `select id from tasks where kind = 'team'`)).rows.length === 3);
check('reviewer defaults to the author', ft.reviewer_id === MANAGER);

await as(MANAGER, `insert into storage.objects (bucket_id, name) values ('deliverables', $1)`, [linkedTask + '/brief/ref.jpg']);
await fails('attachments must be in the task folder', () => as(MANAGER, 'select set_team_task_attachments($1, $2)', [linkedTask, [freeTask + '/x.jpg']]));
await fails('employee cannot change attachments', () => as(EMPLOYEE, 'select set_team_task_attachments($1, $2)', [linkedTask, [linkedTask + '/x.jpg']]));
await as(MANAGER, 'select set_team_task_attachments($1, $2)', [linkedTask, [linkedTask + '/brief/ref.jpg']]);
const files = async (user) => (await as(user, `select name from storage.objects where bucket_id = 'deliverables' and name like $1`, [linkedTask + '/%'])).rows.map(r => r.name);
check('employee reads the task files, client does not',
  (await files(EMPLOYEE)).includes(linkedTask + '/brief/ref.jpg') && (await files(CLIENT)).length === 0);

await fails('team task cannot be scheduled for publishing', () => as(MANAGER, 'select schedule_task($1, now())', [linkedTask]));
await as(EMPLOYEE, 'select start_task($1)', [linkedTask]);
check('employee starts the team task', (await as(EMPLOYEE, 'select status from tasks where id = $1', [linkedTask])).rows[0].status === 'in_progress');
const orderStatusBefore = (await as(MANAGER, 'select status from orders where id = $1', [orderId])).rows[0].status;
await as(EMPLOYEE, `insert into storage.objects (bucket_id, name) values ('deliverables', $1)`, [linkedTask + '/result.jpg']);
await as(EMPLOYEE, `select submit_deliverable($1, 'Готово, 12 кадров', array[$2], 'Свет лучше до 10:00')`, [linkedTask, linkedTask + '/result.jpg']);
check('submitted team task waits for review, order untouched',
  (await as(MANAGER, 'select status from tasks where id = $1', [linkedTask])).rows[0].status === 'internal_review' &&
  (await as(MANAGER, 'select status from orders where id = $1', [orderId])).rows[0].status === orderStatusBefore);
await fails('team task cannot be returned without a comment', () => as(MANAGER, 'select review_task($1, false, $2)', [linkedTask, ' ']));
await fails('employee cannot review', () => as(EMPLOYEE, 'select review_task($1, true)', [linkedTask]));
await as(MANAGER, 'select review_task($1, false, $2)', [linkedTask, 'Нужно ещё 3 кадра крупно']);
check('returned with a comment the employee sees',
  (await as(EMPLOYEE, 'select status from tasks where id = $1', [linkedTask])).rows[0].status === 'in_progress' &&
  (await as(EMPLOYEE, 'select body from task_comments where task_id = $1', [linkedTask])).rows.some(r => r.body === 'Нужно ещё 3 кадра крупно'));
await as(EMPLOYEE, `select submit_deliverable($1, 'Добавил крупные планы', array[$2])`, [linkedTask, linkedTask + '/result.jpg']);
await as(MANAGER, 'select review_task($1, true)', [linkedTask]);
const doneVersion = (await as(MANAGER, 'select sent_to_client_at, reviewer_name from deliverables where task_id = $1 order by version desc limit 1', [linkedTask])).rows[0];
check('accepted team task is done and nothing goes to the client',
  (await as(MANAGER, 'select status from tasks where id = $1', [linkedTask])).rows[0].status === 'approved' &&
  doneVersion.sent_to_client_at === null && doneVersion.reviewer_name === 'Boss');
check('client sees no versions, notes, comments or files of the team task',
  (await as(CLIENT, 'select id from deliverables where task_id = $1', [linkedTask])).rows.length === 0 &&
  (await as(CLIENT, 'select note from deliverable_notes where task_id = $1', [linkedTask])).rows.length === 0 &&
  (await as(CLIENT, 'select id from task_comments where task_id = $1', [linkedTask])).rows.length === 0 &&
  (await files(CLIENT)).length === 0);
await fails('accepted team task cannot be published', () => as(MANAGER, 'select mark_published($1)', [linkedTask]));

await fails('employee cannot edit team tasks', () => as(EMPLOYEE, 'select update_team_task($1, $2, null, $3, null, $4)', [freeTask, 'Y', EMPLOYEE, 'normal']));
await fails('update_team_task does not touch order work', () => as(MANAGER, 'select update_team_task($1, $2, null, $3, null, $4)', [task2, 'Y', EMPLOYEE, 'normal']));
await fails('manager cannot edit the owner task (does not even see it)', () => as(MANAGER, 'select update_team_task($1, $2, null, $3, null, $4)', [spareTask, 'Y', EMPLOYEE, 'normal']));
await as(ADMIN, 'select update_team_task($1, $2, $3, $4, $5, $6, $7)', [spareTask, 'Разобрать архив фото', 'По папкам', EMPLOYEE, '2026-10-25', 'normal', bizId]);
const st = (await as(EMPLOYEE, 'select * from tasks where id = $1', [spareTask])).rows[0];
check('owner edits the team task: assigned now, linked to a client', st?.status === 'assigned' && st.title === 'Разобрать архив фото' && st.business_id === bizId);
await fails('employee cannot delete team tasks', () => as(EMPLOYEE, 'select delete_team_task($1)', [spareTask]));
await fails('delete_team_task does not delete order work', () => as(MANAGER, 'select delete_team_task($1)', [task2]));
await fails('manager cannot delete the owner task', () => as(MANAGER, 'select delete_team_task($1)', [spareTask]));
await as(ADMIN, 'select delete_team_task($1)', [spareTask]);
check('owner deletes a team task', (await as(ADMIN, 'select id from tasks where id = $1', [spareTask])).rows.length === 0);
await fails('order work still needs order fields', () => as(null, `insert into tasks (kind, title) values ('order', 'x')`));
await fails('team task cannot sit on an order', () => as(null, `insert into tasks (kind, title, order_id) values ('team', 'x', $1)`, [orderId]));

// Кто видит задачу команды: автор, исполнитель, проверяющий, отмеченные и владелец. Чужой менеджер — нет.
const MANAGER2 = 'abababab-abab-abab-abab-abababababab';
await db.exec(`insert into auth.users values ('${MANAGER2}', 'm2@x', '{"full_name":"Mila"}')`);
await as(ADMIN, `select set_user_role($1, 'manager')`, [MANAGER2]);
const fullArgs = `select create_team_task($1, $2, $3, null, 'normal', null, $4, null, $5, $6) as id`;
const privTask = (await as(MANAGER2, fullArgs, ['Тайная задача', 'Только для своих', EMPLOYEE, orderId, DESIGNER, [FREELANCER, ADMIN, FREELANCER]])).rows[0].id;
await as(EMPLOYEE, `insert into storage.objects (bucket_id, name) values ('deliverables', $1)`, [privTask + '/secret.jpg']);
await as(EMPLOYEE, `insert into task_comments (task_id, author_id, body) values ($1, $2, 'Начал')`, [privTask, EMPLOYEE]);
await as(EMPLOYEE, 'select start_task($1)', [privTask]);
await as(EMPLOYEE, `select submit_deliverable($1, 'Версия 1', array[$2], 'заметка')`, [privTask, privTask + '/secret.jpg']);
const seenTeam = async (user) => ({
  task: (await as(user, 'select id from tasks where id = $1', [privTask])).rows.length,
  versions: (await as(user, 'select id from deliverables where task_id = $1', [privTask])).rows.length,
  notes: (await as(user, 'select note from deliverable_notes where task_id = $1', [privTask])).rows.length,
  comments: (await as(user, 'select id from task_comments where task_id = $1', [privTask])).rows.length,
  watchers: (await as(user, 'select user_id from task_watchers where task_id = $1', [privTask])).rows.length,
  files: (await as(user, `select name from storage.objects where bucket_id = 'deliverables' and name like $1`, [privTask + '/%'])).rows.length,
  view: (await as(user, 'select can_view_task($1) v', [privTask])).rows[0].v,
  orderNotes: (await as(user, 'select task_order_notes($1) n', [privTask])).rows[0].n,
});
const stranger = await seenTeam(MANAGER);
check('another manager cannot open the task by a direct link, nor its versions, comments or files: ' + JSON.stringify(stranger),
  stranger.task + stranger.versions + stranger.notes + stranger.comments + stranger.watchers + stranger.files === 0 &&
  stranger.view === false && stranger.orderNotes === null);
const clientSeen = await seenTeam(CLIENT);
check('client cannot open the team task either', clientSeen.task + clientSeen.versions + clientSeen.files === 0 && clientSeen.view === false);
await fails('another manager cannot comment on a hidden task', () => as(MANAGER, `insert into task_comments (task_id, author_id, body) values ($1, $2, 'x')`, [privTask, MANAGER]));
await fails('another manager cannot upload into a hidden task', () => as(MANAGER, `insert into storage.objects (bucket_id, name) values ('deliverables', $1)`, [privTask + '/x.jpg']));
for (const [name, id] of [['author', MANAGER2], ['assignee', EMPLOYEE], ['reviewer', DESIGNER], ['watcher', FREELANCER], ['owner', ADMIN]]) {
  const r = await seenTeam(id);
  check(`${name} sees the task with its versions, comments and files`,
    r.task === 1 && r.versions === 1 && r.notes === 1 && r.comments === 1 && r.files === 1 && r.view === true);
}
check('watchers: no duplicates, the owner is not stored (sees everything anyway)',
  (await as(MANAGER2, 'select user_id from task_watchers where task_id = $1', [privTask])).rows.map(r => r.user_id).join() === FREELANCER);
check('reviewer is kept', (await as(ADMIN, 'select reviewer_id from tasks where id = $1', [privTask])).rows[0].reviewer_id === DESIGNER);

await as(MANAGER2, 'select update_team_task($1, $2, $3, $4, null, $5)', [privTask, 'Тайная задача', 'Только для своих', EMPLOYEE, 'normal']);
check('editing without reviewer and watchers keeps them',
  (await as(ADMIN, 'select reviewer_id from tasks where id = $1', [privTask])).rows[0].reviewer_id === DESIGNER &&
  (await as(ADMIN, 'select count(*)::int n from task_watchers where task_id = $1', [privTask])).rows[0].n === 1);
await as(MANAGER2, 'select update_team_task($1, $2, $3, $4, null, $5, null, null, $6, $7)', [privTask, 'Тайная задача', null, EMPLOYEE, 'normal', MANAGER2, [MANAGER]]);
check('watchers replaced: the marked manager now sees the task, the unmarked freelancer does not',
  (await as(MANAGER, 'select id from tasks where id = $1', [privTask])).rows.length === 1 &&
  (await as(FREELANCER, 'select id from tasks where id = $1', [privTask])).rows.length === 0);
await fails('watchers must be team members', () => as(MANAGER2, fullArgs, ['X', null, EMPLOYEE, null, null, [CLIENT]]));
await fails('watchers are set only through task functions', () => as(MANAGER2, 'select set_task_watchers($1, $2)', [privTask, [DESIGNER]]));
await fails('watchers cannot be added directly', () => as(MANAGER2, 'insert into task_watchers (task_id, user_id) values ($1, $2)', [privTask, DESIGNER]));

await fails('manager cannot give a task to the owner', () => as(MANAGER, fullArgs, ['X', null, ADMIN, null, null, []]));
await fails('manager cannot make the owner the reviewer', () => as(MANAGER, fullArgs, ['X', null, EMPLOYEE, null, ADMIN, []]));
await fails('manager cannot reassign a task to the owner', () => as(MANAGER2, 'select update_team_task($1, $2, null, $3, null, $4)', [privTask, 'Y', ADMIN, 'normal']));
const ownerSelf = (await as(ADMIN, fullArgs, ['Себе', null, ADMIN, null, null, []])).rows[0].id;
check('the owner can take a task', (await as(ADMIN, 'select assignee_id from tasks where id = $1', [ownerSelf])).rows[0].assignee_id === ADMIN);
await as(ADMIN, 'select delete_team_task($1)', [ownerSelf]);

await as(MANAGER, `update tasks set title = 'Взлом', due_date = '2000-01-01' where id = $1`, [privTask]);
await as(MANAGER, `update tasks set assignee_id = $2 where id = $1`, [task2, MANAGER]);
check('nobody changes task rows directly, only through functions',
  (await as(ADMIN, 'select title from tasks where id = $1', [privTask])).rows[0].title === 'Тайная задача' &&
  (await as(ADMIN, 'select assignee_id from tasks where id = $1', [task2])).rows[0].assignee_id !== MANAGER);

// Кто что может в задаче команды: правит и удаляет автор и владелец; исполнитель — статус, результат,
// комментарии; проверяющий — принять или вернуть. Отмеченный менеджер только смотрит и пишет комментарии.
const rTask = (await as(MANAGER2, `select create_team_task($1, $2, $3, $4, 'high', null, null, null, $5, $6) as id`,
  ['Снять витрину', 'Вечером, с подсветкой', EMPLOYEE, '2026-11-01', DESIGNER, [MANAGER]])).rows[0].id;
const rRow = async () => (await as(ADMIN, 'select * from tasks where id = $1', [rTask])).rows[0];
const editArgs = 'select update_team_task($1, $2, $3, $4, $5, $6)';
const hack = [rTask, 'Взлом', 'Другое описание', EMPLOYEE, '2000-01-01', 'low'];
await fails('assignee cannot change the text or the due date', () => as(EMPLOYEE, editArgs, hack));
await fails('assignee cannot hand the task to someone else', () => as(EMPLOYEE, editArgs, [rTask, 'Снять витрину', null, DESIGNER, null, 'high']));
await fails('reviewer cannot change the text, due date or assignee', () => as(DESIGNER, editArgs, hack));
await fails('a marked manager cannot edit a task of another manager', () => as(MANAGER, editArgs, hack));
await fails('a marked manager cannot delete a task of another manager', () => as(MANAGER, 'select delete_team_task($1)', [rTask]));
await fails('assignee cannot delete the task', () => as(EMPLOYEE, 'select delete_team_task($1)', [rTask]));
await fails('reviewer cannot delete the task', () => as(DESIGNER, 'select delete_team_task($1)', [rTask]));
await fails('a marked manager cannot change files of the assignment', () => as(MANAGER, 'select set_team_task_attachments($1, $2)', [rTask, []]));
await fails('board assignment does not touch team tasks, even for the author', () => as(MANAGER2, 'select assign_task($1, $2)', [rTask, DESIGNER]));
let rt = await rRow();
check('the task is untouched after all those attempts',
  rt.title === 'Снять витрину' && rt.brief === 'Вечером, с подсветкой' && rt.due_date.toISOString().startsWith('2026-1') &&
  rt.assignee_id === EMPLOYEE && rt.priority === 'high');

await fails('reviewer cannot upload into the task folder', () => as(DESIGNER, `insert into storage.objects (bucket_id, name) values ('deliverables', $1)`, [rTask + '/r.jpg']));
await fails('a marked manager cannot upload into the task folder', () => as(MANAGER, `insert into storage.objects (bucket_id, name) values ('deliverables', $1)`, [rTask + '/m.jpg']));
await as(MANAGER2, `insert into storage.objects (bucket_id, name) values ('deliverables', $1)`, [rTask + '/brief/plan.pdf']);
await as(EMPLOYEE, `insert into storage.objects (bucket_id, name) values ('deliverables', $1)`, [rTask + '/v1.jpg']);
await fails('nobody but the assignee starts the work', () => as(MANAGER2, 'select start_task($1)', [rTask]));
await as(EMPLOYEE, 'select start_task($1)', [rTask]);
await fails('the author cannot submit the result for the assignee', () => as(MANAGER2, `select submit_deliverable($1, 'за него')`, [rTask]));
await fails('a marked manager cannot submit the result either', () => as(MANAGER, `select submit_deliverable($1, 'за него')`, [rTask]));
await fails('an AI agent cannot submit into a team task for someone else', () => as(null, `select submit_agent_deliverable($1, $2, 'smm', 'текст')`, [rTask, MANAGER2]));
await as(EMPLOYEE, `select submit_deliverable($1, 'Витрина снята', array[$2])`, [rTask, rTask + '/v1.jpg']);
await fails('assignee cannot mark the task done', () => as(EMPLOYEE, 'select review_task($1, true)', [rTask]));
await fails('the author is not the reviewer here and cannot accept', () => as(MANAGER2, 'select review_task($1, true)', [rTask]));
await fails('a marked manager cannot accept', () => as(MANAGER, 'select review_task($1, true)', [rTask]));
await as(MANAGER, `insert into task_comments (task_id, author_id, body) values ($1, $2, 'Отличный ракурс')`, [rTask, MANAGER]);
await as(DESIGNER, 'select review_task($1, false, $2)', [rTask, 'Добавь общий план']);
check('reviewer (not a manager) returns the work with a comment',
  (await rRow()).status === 'in_progress' &&
  (await as(EMPLOYEE, 'select body from task_comments where task_id = $1', [rTask])).rows.map(r => r.body).join('|') === 'Отличный ракурс|Добавь общий план');
const handedVersion = (await as(null, `select submit_agent_deliverable($1, $2, 'smm', 'Подпись к фото') as id`, [rTask, EMPLOYEE])).rows[0].id;
check('the assignee may hand in a version made by an AI agent', !!handedVersion && (await rRow()).status === 'internal_review');
await as(DESIGNER, 'select review_task($1, true)', [rTask]);
check('reviewer accepts: done, the reviewer is recorded on the version',
  (await rRow()).status === 'approved' &&
  (await as(ADMIN, 'select reviewed_by from deliverables where task_id = $1 order by version desc limit 1', [rTask])).rows[0].reviewed_by === DESIGNER);

await as(MANAGER2, 'select update_team_task($1, $2, $3, $4, $5, $6, null, null, $7, $8)',
  [rTask, 'Снять витрину ещё раз', 'Днём', EMPLOYEE, '2026-11-05', 'urgent', MANAGER2, []]);
rt = await rRow();
check('the author changes text, due date, importance, reviewer and «who sees»',
  rt.title === 'Снять витрину ещё раз' && rt.brief === 'Днём' && rt.priority === 'urgent' && rt.reviewer_id === MANAGER2 &&
  (await as(MANAGER, 'select id from tasks where id = $1', [rTask])).rows.length === 0);
await as(MANAGER2, 'select set_team_task_attachments($1, $2)', [rTask, [rTask + '/brief/plan.pdf']]);
await as(ADMIN, 'select update_team_task($1, $2, $3, $4, $5, $6)', [rTask, 'Витрина (владелец)', 'Днём', EMPLOYEE, '2026-11-05', 'urgent']);
check('the owner edits any task', (await rRow()).title === 'Витрина (владелец)');
await fails('the assignee still cannot delete', () => as(EMPLOYEE, 'select delete_team_task($1)', [rTask]));
await as(MANAGER2, 'select delete_team_task($1)', [rTask]);
check('the author deletes own task', (await as(ADMIN, 'select id from tasks where id = $1', [rTask])).rows.length === 0);

// История задачи команды: кто, что и когда изменил. Пишет сама база.
const hTask = (await as(MANAGER2, `select create_team_task($1, $2, $3, $4, 'normal', null, null, null, null, $5) as id`,
  ['Обновить прайс', 'Новые цены', EMPLOYEE, '2026-11-10', [DESIGNER]])).rows[0].id;
const history = async (user) => (await as(user, 'select actor_id, field, old_value, new_value from task_history where task_id = $1 order by created_at, field', [hTask])).rows;
let hh = await history(MANAGER2);
check('creation is one history entry by the author (watchers are part of it)',
  hh.length === 1 && hh[0].field === 'created' && hh[0].actor_id === MANAGER2 && hh[0].new_value === 'Обновить прайс');
await as(MANAGER2, 'select update_team_task($1, $2, $3, $4, $5, $6, $7, null, $8, $9)',
  [hTask, 'Обновить прайс-лист', 'Новые цены', EMPLOYEE, '2026-11-12', 'high', bizId, DESIGNER, [FREELANCER]]);
hh = (await history(MANAGER2)).slice(1);
const byField = Object.fromEntries(hh.map(h => [h.field, h]));
check('an edit records only what changed, old and new, by whom: ' + hh.map(h => h.field).join(),
  hh.map(h => h.field).sort().join() === 'business,due_date,priority,reviewer_id,title,watchers' &&
  hh.every(h => h.actor_id === MANAGER2) &&
  byField.title.old_value === 'Обновить прайс' && byField.title.new_value === 'Обновить прайс-лист' &&
  byField.due_date.old_value === '2026-11-10' && byField.due_date.new_value === '2026-11-12' &&
  byField.priority.new_value === 'high' && byField.business.old_value === null && byField.business.new_value === 'Cafe' &&
  byField.reviewer_id.old_value === MANAGER2 && byField.reviewer_id.new_value === DESIGNER &&
  JSON.stringify(byField.watchers.old_value) === JSON.stringify([DESIGNER]) && JSON.stringify(byField.watchers.new_value) === JSON.stringify([FREELANCER]));
await as(EMPLOYEE, 'select start_task($1)', [hTask]);
await as(EMPLOYEE, `select submit_deliverable($1, 'Готово')`, [hTask]);
await as(DESIGNER, 'select review_task($1, true)', [hTask]);
const statuses = (await history(ADMIN)).filter(h => h.field === 'status').map(h => `${h.old_value}>${h.new_value}:${h.actor_id === EMPLOYEE ? 'assignee' : h.actor_id === DESIGNER ? 'reviewer' : h.actor_id}`);
check('status changes are recorded with who did them: ' + statuses.join(' '),
  statuses.join(' ') === 'assigned>in_progress:assignee in_progress>internal_review:assignee internal_review>approved:reviewer');
check('the assignee, the reviewer and the watcher see the history',
  (await history(EMPLOYEE)).length === hh.length + 4 && (await history(DESIGNER)).length === hh.length + 4 &&
  (await history(FREELANCER)).length === hh.length + 4);
check('a manager who does not see the task and the client see no history',
  (await history(MANAGER)).length === 0 && (await history(CLIENT)).length === 0);
await fails('nobody writes history by hand', () => as(MANAGER2, `insert into task_history (task_id, field) values ($1, 'title')`, [hTask]));
await as(MANAGER2, `update task_history set field = 'x' where task_id = $1`, [hTask]);
await as(MANAGER2, `delete from task_history where task_id = $1`, [hTask]);
check('nobody edits or erases history', (await history(ADMIN)).length === hh.length + 4 && !(await history(ADMIN)).some(h => h.field === 'x'));
const before = (await history(ADMIN)).length;
await as(MANAGER2, 'select update_team_task($1, $2, $3, $4, $5, $6, $7, null, $8, $9)',
  [hTask, 'Обновить прайс-лист', 'Новые цены', EMPLOYEE, '2026-11-12', 'high', bizId, DESIGNER, [FREELANCER]]);
check('saving without changes adds nothing', (await history(ADMIN)).length === before);
check('order work keeps no team history', (await as(ADMIN, 'select count(*)::int n from task_history h join tasks t on t.id = h.task_id where t.kind = $1', ['order'])).rows[0].n === 0);

// Уведомления по задачам команды.
const notesFor = async (taskId) => (await as(null,
  `select user_id, kind, payload from notifications where payload ->> 'task_id' = $1 order by created_at, kind`, [taskId])).rows;
const tomorrow = (await as(null, `select (yerevan_today() + 1)::text as d`)).rows[0].d;
const ntask = (await as(MANAGER, teamTaskArgs, ['Снять меню', null, EMPLOYEE, tomorrow, 'urgent', bizId, null])).rows[0].id;
let nn = await notesFor(ntask);
check('employee is notified as soon as the team task is created, with title and priority',
  nn.length === 1 && nn[0].kind === 'task_assigned' && nn[0].user_id === EMPLOYEE &&
  nn[0].payload.kind === 'team' && nn[0].payload.title === 'Снять меню' && nn[0].payload.priority === 'urgent' &&
  nn[0].payload.business === 'Cafe');
const quiet = (await as(MANAGER, teamTaskArgs, ['Без исполнителя', null, null, null, 'normal', null, null])).rows[0].id;
check('no notification for a task without an assignee', (await notesFor(quiet)).length === 0);
await as(MANAGER, 'select update_team_task($1, $2, null, $3, null, $4)', [quiet, 'Без исполнителя', DESIGNER, 'normal']);
check('assigning later notifies the assignee', (await notesFor(quiet)).map(n => `${n.kind}:${n.user_id}`).join() === `task_assigned:${DESIGNER}`);
await as(null, `update tasks set due_reminded_on = null where id = $1`, [ntask]);
await as(null, 'select process_due_reminders()');
check('employee is reminded a day before the due date',
  (await notesFor(ntask)).some(n => n.kind === 'task_due_soon' && n.user_id === EMPLOYEE));
await as(EMPLOYEE, 'select start_task($1)', [ntask]);
await as(EMPLOYEE, `select submit_deliverable($1, 'Меню снято')`, [ntask]);
nn = await notesFor(ntask);
check('the reviewer (here the author) is notified when the work is submitted, nobody else',
  nn.filter(n => n.kind === 'task_review').map(n => n.user_id).join() === MANAGER);
await as(MANAGER, 'select review_task($1, false, $2)', [ntask, 'Нужен вертикальный кадр']);
nn = await notesFor(ntask);
check('employee is notified of the return together with the comment',
  nn.some(n => n.kind === 'task_returned' && n.user_id === EMPLOYEE && n.payload.comment === 'Нужен вертикальный кадр'));
await as(EMPLOYEE, `select submit_deliverable($1, 'Добавил вертикальный')`, [ntask]);
await as(MANAGER, 'select review_task($1, true)', [ntask]);
nn = await notesFor(ntask);
check('employee is notified when the work is accepted, the client is not notified at all',
  nn.some(n => n.kind === 'task_done' && n.user_id === EMPLOYEE) && !nn.some(n => n.user_id === CLIENT));

// Уведомления только тем, кто видит задачу; остальным менеджерам — только число.
const yesterday = (await as(null, `select (yerevan_today() - 1)::text as d`)).rows[0].d;
const secret = (await as(MANAGER2, `select create_team_task($1, null, $2, $3, 'normal', null, null, null, $4, '{}') as id`,
  ['Секретная съёмка', EMPLOYEE, yesterday, DESIGNER])).rows[0].id;
const known = (await as(MANAGER2, `select create_team_task($1, null, $2, $3, 'normal', null, null, null, null, $4) as id`,
  ['Известная съёмка', EMPLOYEE, yesterday, [MANAGER]])).rows[0].id;
await as(null, 'delete from notifications');
await as(null, `update tasks set due_reminded_on = null where id = any($1)`, [[secret, known]]);
await as(null, 'select process_due_reminders()');
const overdueTo = async (taskId) => (await notesFor(taskId)).filter(n => n.kind === 'task_overdue').map(n => n.user_id).sort().join();
check('an overdue team task: assignee, author, reviewer and owner are told, not other managers',
  await overdueTo(secret) === [EMPLOYEE, MANAGER2, DESIGNER, ADMIN].sort().join());
check('a marked manager is told about the task they see',
  (await overdueTo(known)).split(',').includes(MANAGER));
const hiddenNotes = (await as(null, `select user_id, payload from notifications where kind = 'team_overdue_hidden'`)).rows;
check('a manager who does not see some overdue tasks gets only their number, no titles: ' + JSON.stringify(hiddenNotes.map(n => n.payload)),
  hiddenNotes.some(n => n.user_id === MANAGER && n.payload.count >= 1 && !JSON.stringify(n.payload).includes('Секрет')) &&
  !hiddenNotes.some(n => n.user_id === ADMIN || n.user_id === MANAGER2 && n.payload.count < 1));
check('no notification anywhere carries the hidden title to someone who cannot see it',
  !(await as(null, `select user_id from notifications where payload::text like '%Секретная%'`)).rows
    .some(n => ![EMPLOYEE, MANAGER2, DESIGNER, ADMIN].includes(n.user_id)));
await as(null, `select notify_users(array[$1, $2]::uuid[], 'task_assigned', task_payload(t)) from tasks t where id = $3`, [MANAGER, FREELANCER, secret]);
check('safety net: a team-task notification to someone who does not see the task is not written',
  (await notesFor(secret)).filter(n => n.kind === 'task_assigned' && [MANAGER, FREELANCER].includes(n.user_id)).length === 0);
await as(EMPLOYEE, 'select start_task($1)', [secret]);
await as(EMPLOYEE, `select submit_deliverable($1, 'Сняла')`, [secret]);
check('submission goes to the reviewer only',
  (await notesFor(secret)).filter(n => n.kind === 'task_review').map(n => n.user_id).join() === DESIGNER);
const dashMgr = (await as(MANAGER, 'select owner_dashboard() d')).rows[0].d;
check('team workload shows numbers only, no task titles', !JSON.stringify(dashMgr).includes('Секретная'));

// «Передать человеку»: задача команды из работы AI-агента.
const runOf = async (agent, status) => (await as(null,
  `insert into agent_runs (agent, status, chat, instructions, result, created_by) values ($1, $2, true, 'Пост про осень', $3, $4) returning id`,
  [agent, status, JSON.stringify({ text: 'Осень в каждой чашке', caption: null, files: [] }), MANAGER])).rows[0].id;
const doneRun = await runOf('smm', 'done');
const handoffArgs = `select create_team_task($1, $2, $3, null, 'normal', null, null, $4) as id`;
const handed = (await as(MANAGER, handoffArgs, ['Доработать черновик', 'Осень в каждой чашке', EMPLOYEE, doneRun])).rows[0].id;
const ht = (await as(EMPLOYEE, 'select from_agent_run_id, draft_agent, brief from tasks where id = $1', [handed])).rows[0];
check('handed-off task remembers the agent work and shows the agent to the employee',
  ht.from_agent_run_id === doneRun && ht.draft_agent === 'smm' && ht.brief === 'Осень в каждой чашке');
check('employee does not see the agent run itself', (await as(EMPLOYEE, 'select id from agent_runs where id = $1', [doneRun])).rows.length === 0);
await fails('unfinished agent work cannot be handed off', async () => as(MANAGER, handoffArgs, ['X', null, EMPLOYEE, await runOf('designer', 'running')]));
await fails('AI manager plan is not a draft', async () => as(MANAGER, handoffArgs, ['X', null, EMPLOYEE, await runOf('manager', 'done')]));
await fails('only managers hand off agent work', () => as(DESIGNER, handoffArgs, ['X', null, EMPLOYEE, doneRun]));
check('manager can put the draft files into the new task folder',
  (await as(MANAGER, `insert into storage.objects (bucket_id, name) values ('deliverables', $1) returning name`, [handed + '/draft.png'])).rows.length === 1);

// «Нагрузка команды»: задачи команды у людей, отдельный список агентов.
const loadTask = (await as(MANAGER, teamTaskArgs, ['Нагрузка: разобрать фото', null, EMPLOYEE, '2026-01-01', 'normal', null, null])).rows[0].id;
const doneTeam = (await as(MANAGER, teamTaskArgs, ['Нагрузка: готово', null, EMPLOYEE, null, 'normal', null, null])).rows[0].id;
await as(null, `update tasks set status = 'approved' where id = $1`, [doneTeam]);
const dash = (await as(MANAGER, 'select owner_dashboard() d')).rows[0].d;
const empLoad = dash.workload.find(w => w.id === EMPLOYEE);
const sql = async (q, p) => Number((await as(null, q, p)).rows[0].n);
check('employee workload counts open team tasks, with job title, not finished ones',
  empLoad.job_title === 'Фотограф' && Number(empLoad.team_open) ===
    await sql(`select count(*) n from tasks where assignee_id = $1 and kind = 'team' and is_open_task_status(status)`, [EMPLOYEE]) &&
  Number(empLoad.open) === await sql(`select count(*) n from tasks where assignee_id = $1 and is_open_task_status(status)`, [EMPLOYEE]) &&
  Number(empLoad.overdue) >= 1);
check('finished team tasks are not «to publish»',
  Number(dash.tasks.publish) === await sql(`select count(*) n from tasks where kind = 'order' and status in ('approved', 'publishing')`) &&
  Number(dash.tasks.team_open) === await sql(`select count(*) n from tasks where kind = 'team' and is_open_task_status(status)`));
const agentsLoad = Object.fromEntries(dash.workload_agents.map(a => [a.id, a]));
check('agents workload lists all six agents with running, review and weekly counts',
  dash.workload_agents.length === 6 &&
  Number(agentsLoad.smm.done_week) === await sql(`select count(*) n from agent_runs where agent = 'smm' and status in ('done', 'applied') and created_at >= now() - interval '7 days'`) &&
  Number(agentsLoad.designer.running) === await sql(`select count(*) n from agent_runs where agent = 'designer' and status = 'running'`) &&
  Number(agentsLoad.designer.to_review) === await sql(`select count(*) n from tasks t where status = 'internal_review' and (select agent from deliverables d where d.task_id = t.id order by version desc limit 1) = 'designer'`));
check('agent load is not empty in this test run', dash.workload_agents.some(a => Number(a.running) + Number(a.done_week) + Number(a.to_review) > 0));

// Аудит функций: security definer — только с search_path; новые функции задач команды — не для anon,
// служебные (проверки, триггеры) — вообще не для пользователей.
const unsafe = (await as(null, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)).rows.map(r => r.proname);
check('every security definer function pins search_path: ' + unsafe.join(), unsafe.length === 0);
const canRun = async (role, fn) => (await as(null, `select bool_or(has_function_privilege($1, p.oid, 'execute')) v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $2`, [role, fn])).rows[0].v;
const userFns = ['create_team_task', 'update_team_task', 'set_team_task_attachments', 'delete_team_task', 'set_job_title', 'task_order_notes', 'owner_dashboard'];
const anonOpen = [];
for (const fn of userFns) if (await canRun('anon', fn)) anonOpen.push(fn);
check('team task functions are closed to anonymous visitors: ' + anonOpen.join(), anonOpen.length === 0);
const internalOpen = [];
for (const fn of ['team_task_business', 'check_team_assignee', 'on_task_created', 'task_payload', 'notify_users', 'team_task_for_edit', 'set_task_watchers', 'log_team_task', 'user_sees_team_task', 'skip_hidden_task_notification'])
  for (const role of ['anon', 'authenticated']) if (await canRun(role, fn)) internalOpen.push(`${fn}:${role}`);
check('internal helpers are not callable by users: ' + internalOpen.join(), internalOpen.length === 0);

// Тестовая оплата подтверждается только владельцем: payment-test-confirm спрашивает у базы is_admin().
const adminAnswers = {};
for (const [name, id] of [['client', CLIENT], ['manager', MANAGER], ['designer', DESIGNER], ['employee', EMPLOYEE], ['owner', ADMIN]])
  adminAnswers[name] = (await as(id, 'select is_admin() v')).rows[0].v;
check('is_admin is true only for the owner: ' + JSON.stringify(adminAnswers),
  adminAnswers.owner === true && ['client', 'manager', 'designer', 'employee'].every(n => adminAnswers[n] === false));
const testOrder = (await as(CLIENT, `select create_order($1, '[{"service_id":"post","platform_id":"instagram","quantity":1}]'::jsonb, 'one_time', 'team') as id`, [bizId])).rows[0].id;
const testPay = (await as(null, `insert into payments (order_id, provider, amount_amd) values ($1, 'test', 8000) returning id`, [testOrder])).rows[0].id;
check('owner sees the pending test payment of a client order',
  (await as(ADMIN, `select id from payments where order_id = $1 and provider = 'test' and status = 'created'`, [testOrder])).rows.length === 1);
await fails('client cannot confirm a test payment by itself', () => as(CLIENT, `select mark_payment_succeeded($1, 'x', '{}')`, [testPay]));
await fails('manager cannot confirm a test payment directly either', () => as(MANAGER, `select mark_payment_succeeded($1, 'x', '{}')`, [testPay]));

console.log(process.exitCode ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED');
