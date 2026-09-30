// Проверка демо-данных (supabase/seed.sql) на встроенном Postgres с заглушками Supabase.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage; create schema extensions; create schema vault;
  create table auth.users (
    instance_id uuid, id uuid primary key, aud text, role text, email text, encrypted_password text,
    email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
    created_at timestamptz, updated_at timestamptz, confirmation_token text, recovery_token text,
    email_change text, email_change_token_new text);
  create table auth.identities (id uuid, user_id uuid, provider_id text, identity_data jsonb, provider text,
    last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create function extensions.gen_salt(text) returns text language sql as $$ select 'salt' $$;
  create function extensions.crypt(text, text) returns text language sql as $$ select 'hash:' || $1 $$;
  create table vault.secrets (name text primary key, secret text);
  create function vault.create_secret(s text, n text) returns uuid language sql as $$ insert into vault.secrets values (n, s); select gen_random_uuid() $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
`);
for (const f of fs.readdirSync(root + 'migrations').sort()) await db.exec(fs.readFileSync(root + 'migrations/' + f, 'utf8'));
await db.exec(fs.readFileSync(root + 'seed.sql', 'utf8'));

const q = async (sql) => (await db.query(sql)).rows;
let ok = true;
const check = (l, v) => { console.log(v ? 'PASS' : 'FAIL', l); if (!v) ok = false; };
const roles = (await q(`select email, role from public.profiles order by email`)).map(r => `${r.email.split('@')[0]}=${r.role}`).join(' ');
console.log('   users:', roles);
check('6 demo users incl. admin and pending', roles === 'admin=admin client=client designer=designer freelancer=freelancer manager=manager newbie=pending');
check('identities created', (await q('select count(*)::int n from auth.identities'))[0].n === 6);
const tasks = await q(`select platform_id || '/' || service_id || number as t, status from public.tasks order by platform_id, service_id, number`);
console.log('   tasks:', tasks.map(t => `${t.t}=${t.status}`).join(' '));
check('7 tasks in varied states', tasks.length === 7 && new Set(tasks.map(t => t.status)).size === 7);
check('order in progress, paid', (await q(`select status, paid_at from public.orders`))[0].status === 'in_progress');
check('client sees only sent deliverables (2 of 4 sent + published)', (await q(`select count(*)::int n from public.deliverables where sent_to_client_at is not null`))[0].n === 3);
check('chat messages with author names', (await q(`select author_name from public.messages order by created_at`)).map(r => r.author_name).join('|') === 'Анна Петросян|Нарек');
check('team chat seeded (2 general + 2 direct)', (await q('select count(*)::int n from public.team_messages'))[0].n === 4);
check('direct conversation has 2 members', (await q(`select count(*)::int n from public.conversation_members where conversation_id = '55555555-0000-4000-8000-000000000001'`))[0].n === 2);
check('notifications queue cleared', (await q('select count(*)::int n from public.notifications'))[0].n === 0);
check('vault secrets set', (await q('select count(*)::int n from vault.secrets'))[0].n === 3);
console.log(ok ? 'SEED OK' : 'SEED FAILED');
if (!ok) process.exitCode = 1;
