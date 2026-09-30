-- Этап 4: согласование клиентом, чат по заказу, уведомления (push + Telegram).

create function public.is_order_client(p_order_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (select 1 from public.orders where id = p_order_id and client_id = auth.uid());
$$;

-- ---------- Согласование ----------

create type public.approval_decision as enum ('approved', 'changes_requested');

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  deliverable_id uuid not null references public.deliverables (id) on delete cascade,
  decision public.approval_decision not null,
  comment text,
  decided_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index approvals_task_id_idx on public.approvals (task_id);

-- Клиент одобряет последнюю версию или просит правки (с комментарием).
create function public.client_decide(p_task_id uuid, p_approve boolean, p_comment text default null)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_task public.tasks;
  v_deliverable_id uuid;
begin
  select t.* into v_task
  from public.tasks t
  join public.orders o on o.id = t.order_id
  where t.id = p_task_id and o.client_id = auth.uid()
  for update of t;
  if not found then
    raise exception 'task not found';
  end if;
  if v_task.status <> 'client_review' then
    raise exception 'task is not waiting for your decision';
  end if;
  if not p_approve and nullif(trim(p_comment), '') is null then
    raise exception 'describe what to change';
  end if;

  select id into v_deliverable_id
  from public.deliverables
  where task_id = p_task_id
  order by version desc
  limit 1;

  insert into public.approvals (task_id, deliverable_id, decision, comment, decided_by)
  values (
    p_task_id,
    v_deliverable_id,
    case when p_approve then 'approved' else 'changes_requested' end::public.approval_decision,
    nullif(trim(p_comment), ''),
    auth.uid()
  );

  update public.tasks
     set status = case when p_approve then 'approved' else 'changes_requested' end::public.task_status
   where id = p_task_id;
end;
$$;

revoke execute on function public.client_decide from public, anon;
grant execute on function public.client_decide to authenticated;

alter table public.approvals enable row level security;

create policy "approvals: read"
  on public.approvals for select
  using (public.can_view_task(task_id));

-- ---------- Чат по заказу (клиент ↔ штатная команда) ----------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id),
  -- Имя и сторона автора копируются при отправке: клиент не видит профили команды.
  author_name text not null default '',
  from_client boolean not null default false,
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index messages_order_id_idx on public.messages (order_id, created_at);

create function public.fill_message_author()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  select coalesce(nullif(full_name, ''), email, ''), role = 'client'
    into new.author_name, new.from_client
  from public.profiles
  where id = new.author_id;
  new.body = trim(new.body);
  return new;
end;
$$;

create trigger messages_fill_author
  before insert on public.messages
  for each row execute function public.fill_message_author();

alter table public.messages enable row level security;

create policy "messages: read"
  on public.messages for select
  using (public.is_order_client(order_id) or public.is_team());

create policy "messages: write"
  on public.messages for insert
  with check (
    author_id = auth.uid()
    and (public.is_order_client(order_id) or public.is_team())
  );

-- Новые сообщения приходят в приложение в реальном времени.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

-- ---------- Каналы уведомлений ----------

alter table public.profiles
  add column expo_push_token text,
  add column telegram_chat_id bigint,
  add column telegram_link_code text unique;

grant update (expo_push_token) on public.profiles to authenticated;

-- Код для привязки Telegram: пользователь открывает t.me/<бот>?start=<код>.
create function public.create_telegram_link_code()
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  v_code text := replace(gen_random_uuid()::text, '-', '');
begin
  update public.profiles set telegram_link_code = v_code where id = auth.uid();
  return v_code;
end;
$$;

revoke execute on function public.create_telegram_link_code from public, anon;
grant execute on function public.create_telegram_link_code to authenticated;

-- Очередь уведомлений. Каждую новую строку отправляет Edge Function notify-dispatch
-- (Database Webhook на INSERT в эту таблицу).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);

create index notifications_user_id_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "notifications: read own"
  on public.notifications for select
  using (user_id = auth.uid());

create function public.notify_users(p_user_ids uuid[], p_kind text, p_payload jsonb)
returns void
language sql
security definer set search_path = ''
as $$
  insert into public.notifications (user_id, kind, payload)
  select distinct u, p_kind, p_payload
  from unnest(p_user_ids) as u
  where u is not null;
$$;

revoke execute on function public.notify_users from public, anon, authenticated;

create function public.manager_ids()
returns uuid[]
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(array_agg(id), '{}') from public.profiles where role = 'manager';
$$;

create function public.task_payload(p_task public.tasks)
returns jsonb
language sql
stable
security definer set search_path = ''
as $$
  select jsonb_build_object(
    'task_id', p_task.id,
    'order_id', p_task.order_id,
    'service_id', p_task.service_id,
    'number', p_task.number,
    'business', (select name from public.businesses where id = p_task.business_id)
  );
$$;

create function public.on_task_changed()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_payload jsonb := public.task_payload(new);
  v_client uuid := (select client_id from public.orders where id = new.order_id);
  v_comment text;
begin
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id then
    perform public.notify_users(array[new.assignee_id], 'task_assigned', v_payload);
  end if;

  if new.status is distinct from old.status then
    if new.status = 'internal_review' then
      perform public.notify_users(public.manager_ids(), 'task_review', v_payload);
    elsif new.status = 'in_progress' and old.status = 'internal_review' then
      perform public.notify_users(array[new.assignee_id], 'task_returned', v_payload);
    elsif new.status = 'client_review' then
      perform public.notify_users(array[v_client], 'client_review', v_payload);
    elsif new.status in ('approved', 'changes_requested') then
      select comment into v_comment
      from public.approvals where task_id = new.id order by created_at desc limit 1;
      perform public.notify_users(
        public.manager_ids() || new.assignee_id,
        case when new.status = 'approved' then 'client_approved' else 'client_changes' end,
        v_payload || jsonb_build_object('comment', v_comment)
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger tasks_notify
  after update on public.tasks
  for each row execute function public.on_task_changed();

create function public.on_message_created()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object(
    'order_id', new.order_id,
    'author', new.author_name,
    'preview', left(new.body, 200),
    'business', (
      select b.name from public.orders o join public.businesses b on b.id = o.business_id
      where o.id = new.order_id
    )
  );
begin
  if new.from_client then
    perform public.notify_users(public.manager_ids(), 'client_message', v_payload);
  else
    perform public.notify_users(
      array[(select client_id from public.orders where id = new.order_id)],
      'team_message',
      v_payload
    );
  end if;
  return new;
end;
$$;

create trigger messages_notify
  after insert on public.messages
  for each row execute function public.on_message_created();

-- ---------- AI-подсказки ответа в чате ----------
-- Журнал AI теперь хранит и подсказки для чата (без задачи, с заказом).
alter table public.ai_generations
  alter column task_id drop not null,
  add column order_id uuid references public.orders (id) on delete cascade;

create policy "ai_generations: team reads chat drafts"
  on public.ai_generations for select
  using (order_id is not null and public.is_team());
