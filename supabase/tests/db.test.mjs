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
await as(FREELANCER, `select submit_deliverable($1, 'Осенний пост, 5000 драм', array[$2])`, [task, task + '/photo.png']);
check('draft in internal review hidden from client', (await as(CLIENT, 'select * from deliverables where task_id=$1', [task])).rows.length === 0);
await as(MANAGER, `select review_task($1, true)`, [task]);
const versions = (await as(CLIENT, 'select version from deliverables where task_id=$1 order by version', [task])).rows.map(r => r.version);
check('client sees only the version sent to them, task in client_review',
  JSON.stringify(versions) === '[2]' && (await as(CLIENT, 'select status from tasks where id=$1', [task])).rows[0].status === 'client_review');
check('client sees file of the sent version', (await as(CLIENT, `select * from storage.objects`)).rows.length === 1);
check('team still sees all versions', (await as(DESIGNER, 'select version from deliverables where task_id=$1', [task])).rows.length === 2);
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

console.log(process.exitCode ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED');
