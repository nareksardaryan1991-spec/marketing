// Запуск: node scripts/deploy-rehearsal.mjs ~/backups/marketing/data-<дата>.sql
// Перед новой выкладкой поменять границу '0020' на первую ещё не выложенную миграцию.
// Репетиция выкладки: база как на сервере (миграции 0001–0019) + настоящие данные из копии,
// затем новые миграции 0020–0031 и сверка. Печатает только числа и ошибки — не содержимое данных.
import { PGlite } from '/home/narek/Documents/marketing/supabase/tests/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';

const MIG = '/home/narek/Documents/marketing/supabase/migrations/';
const DATA = process.argv[2];
const db = new PGlite();
const say = (...a) => console.log(...a);
let problems = 0;
const check = (label, ok, detail = '') => { say(ok ? 'OK  ' : 'FAIL', label, detail); if (!ok) problems++; };
const clean = (e) => String(e.message).replace(/\(([^)]*)\)=\([^)]*\)/g, '($1)=(…)').slice(0, 300);

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
const files = fs.readdirSync(MIG).sort();
for (const f of files.filter((f) => f < '0020')) await db.exec(fs.readFileSync(MIG + f, 'utf8'));
say('собрана база как на сервере: миграции до', files.filter((f) => f < '0020').at(-1));

// Данные из копии заменяют то, что миграции положили сами (услуги, площадки, настройки).
const tables = (await db.query(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.tablename);
await db.exec(`set session_replication_role = replica; truncate ${tables.map((t) => `public."${t}"`).join(', ')} cascade;`);
const dump = fs.readFileSync(DATA, 'utf8').split('\n').filter((l) => !l.startsWith('\\')).join('\n');
try { await db.exec(dump); say('данные загружены'); }
catch (e) { check('загрузка данных', false, clean(e)); process.exit(1); }
// Пользователи входа — те же id, что у профилей; без триггеров: профили уже загружены.
await db.exec(`insert into auth.users (id, email) select id, email from public.profiles on conflict do nothing;`);
await db.exec(`set session_replication_role = origin;`);
// Копия обнуляет search_path и выключает row_security в сессии — возвращаем.
await db.exec(`set search_path = "$user", public; set row_security = on;`);

const count = async (sql, p) => Number((await db.query(sql, p)).rows[0].n);
const as = async (user, sql, p) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub', '${user}', false);`);
  try { return await db.query(sql, p); } finally { await db.exec('reset role;'); }
};

const before = {};
for (const t of tables) before[t] = await count(`select count(*) n from public."${t}"`);
const roles = (await db.query(`select role::text, count(*)::int n from profiles group by 1 order by 1`)).rows;
say('роли:', roles.map((r) => `${r.role}=${r.n}`).join(' '));
const notesBefore = await count(`select count(*) n from deliverables where nullif(trim(note), '') is not null`);
const clients = (await db.query(`select id from profiles where role = 'client'`)).rows.map((r) => r.id);
const seen = async () => {
  const r = {};
  for (const c of clients) r[c] = {
    tasks: (await as(c, 'select count(*)::int n from tasks')).rows[0].n,
    orders: (await as(c, 'select count(*)::int n from orders')).rows[0].n,
    versions: (await as(c, 'select count(*)::int n from deliverables')).rows[0].n,
  };
  return r;
};
const clientBefore = await seen();
say(`клиентов: ${clients.length}, задач: ${before.tasks}, заказов: ${before.orders}, версий: ${before.deliverables} (с заметкой: ${notesBefore})`);

for (const f of files.filter((f) => f >= '0020')) {
  try { await db.exec(fs.readFileSync(MIG + f, 'utf8')); say('OK   применена', f); }
  catch (e) { check('миграция ' + f, false, clean(e)); process.exit(1); }
}

const lost = [];
for (const t of tables) {
  if (!(await count(`select count(*) n from pg_tables where schemaname = 'public' and tablename = $1`, [t]))) { lost.push(t + ' (таблицы нет)'); continue; }
  const n = await count(`select count(*) n from public."${t}"`);
  if (n < before[t]) lost.push(`${t}: ${before[t]} → ${n}`);
}
check('ни в одной таблице не пропали строки', lost.length === 0, lost.join('; '));
check('заметки к версиям переехали в deliverable_notes', await count(`select count(*) n from deliverable_notes`) === notesBefore, `(${notesBefore})`);
check('все работы агентов — у пяти новых агентов',
  await count(`select count(*) n from agent_runs where agent not in ('smm', 'designer', 'scriptwriter', 'targetologist', 'seo', 'manager')`) === 0);
check('все прежние задачи стали «по заказу»',
  await count(`select count(*) n from tasks where kind <> 'order'`) === 0 && await count(`select count(*) n from tasks`) === before.tasks);
const clientAfter = await seen();
const changed = clients.filter((c) => !(clientAfter[c].tasks === clientBefore[c].tasks && clientAfter[c].orders === clientBefore[c].orders && clientAfter[c].versions <= clientBefore[c].versions));
check('каждый клиент видит те же задачи и заказы (версий — не больше)', changed.length === 0, changed.length ? `расхождений: ${changed.length}` : '');

const admin = (await db.query(`select id from profiles where role = 'admin' limit 1`)).rows[0]?.id;
const manager = (await db.query(`select id from profiles where role in ('manager', 'admin') order by role desc limit 1`)).rows[0]?.id;
const staff = (await db.query(`select id from profiles where role not in ('client', 'pending') order by role limit 1`)).rows[0]?.id;
if (admin) {
  try {
    const d = (await as(admin, 'select owner_dashboard() d')).rows[0].d;
    check('панель владельца открывается', Array.isArray(d.workload) && d.workload_agents.length === 6, `(людей в нагрузке: ${d.workload.length})`);
  } catch (e) { check('панель владельца открывается', false, clean(e)); }
}
if (manager && staff && clients.length) {
  try {
    const id = (await as(manager, `select create_team_task('Репетиция', null, $1, null, 'normal', null, null) as id`, [staff])).rows[0].id;
    const visible = [];
    for (const c of clients) if ((await as(c, 'select id from tasks where id = $1', [id])).rows.length) visible.push(c);
    check('задача команды создаётся, клиенты её не видят', visible.length === 0);
    check('исполнителю ушло уведомление о назначении', await count(`select count(*) n from notifications where payload ->> 'task_id' = $1`, [id]) === 1);
  } catch (e) { check('задача команды создаётся', false, clean(e)); }
}
try { await db.exec('select process_due_reminders(); select process_daily_digest();'); check('ежедневные напоминания и сводка работают на этих данных', true); }
catch (e) { check('ежедневные напоминания и сводка', false, clean(e)); }
say(problems ? `ПРОБЛЕМ: ${problems}` : 'РЕПЕТИЦИЯ ПРОШЛА');
process.exitCode = problems ? 1 : 0;
