-- Этап 3: работа команды — назначение задач, версии материалов, комментарии, AI.

-- Email в профиле, чтобы менеджер видел, кто есть кто.
alter table public.profiles add column email text;
update public.profiles p set email = u.email from auth.users u where u.id = p.id;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, language, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'language', ''), 'ru'),
    new.email
  );
  return new;
end;
$$;

-- Задание от менеджера исполнителю.
alter table public.tasks add column brief text;

-- Версия материала: текст + файлы в Storage (bucket deliverables, путь <task_id>/...).
create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  version integer not null,
  caption text,
  files text[] not null default '{}',
  note text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (task_id, version)
);

-- Внутренние комментарии команды по задаче.
create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index task_comments_task_id_idx on public.task_comments (task_id);

-- Журнал обращений к AI (для контроля расходов).
create table public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  kind text not null,
  language text not null,
  instructions text,
  output text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index ai_generations_task_id_idx on public.ai_generations (task_id);

-- Может ли текущий пользователь работать с задачей: штатная команда или назначенный исполнитель.
create function public.can_work_on_task(p_task_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.is_team()
    or exists (select 1 from public.tasks where id = p_task_id and assignee_id = auth.uid());
$$;

-- Плюс клиент — владелец заказа (увидит материалы на согласовании, этап 4).
create function public.can_view_task(p_task_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.can_work_on_task(p_task_id)
    or exists (
      select 1 from public.tasks t
      join public.orders o on o.id = t.order_id
      where t.id = p_task_id and o.client_id = auth.uid()
    );
$$;

-- Фрилансер видит бизнес и заказ только по своим задачам.
-- security definer: иначе политики orders и tasks ссылались бы друг на друга по кругу.
create function public.is_assignee_of_business(p_business_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tasks where business_id = p_business_id and assignee_id = auth.uid()
  );
$$;

create function public.is_assignee_of_order(p_order_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tasks where order_id = p_order_id and assignee_id = auth.uid()
  );
$$;

create policy "businesses: read by assignee"
  on public.businesses for select
  using (public.is_assignee_of_business(id));

create policy "orders: read by assignee"
  on public.orders for select
  using (public.is_assignee_of_order(id));

-- Любой сотрудник (включая фрилансера) видит профили коллег — например, автора комментария.
create policy "profiles: staff see staff"
  on public.profiles for select
  using (role <> 'client' and public.my_role() <> 'client');

-- Переходы статусов — только через функции ниже.

create function public.assign_task(
  p_task_id uuid,
  p_assignee_id uuid,
  p_due_date date default null,
  p_brief text default null
)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'only managers can assign tasks';
  end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.profiles where id = p_assignee_id and role <> 'client'
  ) then
    raise exception 'assignee must be a team member';
  end if;

  update public.tasks
     set assignee_id = p_assignee_id,
         due_date = p_due_date,
         brief = nullif(trim(p_brief), ''),
         status = case
           when status = 'new' and p_assignee_id is not null then 'assigned'::public.task_status
           when status = 'assigned' and p_assignee_id is null then 'new'::public.task_status
           else status
         end
   where id = p_task_id;
  if not found then
    raise exception 'task not found';
  end if;
end;
$$;

create function public.start_task(p_task_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.tasks
     set status = 'in_progress'
   where id = p_task_id
     and assignee_id = auth.uid()
     and status = 'assigned';
  if not found then
    raise exception 'task cannot be started';
  end if;

  -- Первая задача по заказу переводит заказ в работу.
  update public.orders o
     set status = 'in_progress'
    from public.tasks t
   where t.id = p_task_id and o.id = t.order_id and o.status = 'paid';
end;
$$;

create function public.submit_deliverable(
  p_task_id uuid,
  p_caption text,
  p_files text[] default '{}',
  p_note text default null
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_task public.tasks;
  v_id uuid;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or not (v_task.assignee_id = auth.uid() or public.is_manager()) then
    raise exception 'task not found';
  end if;
  if v_task.status not in ('assigned', 'in_progress', 'changes_requested') then
    raise exception 'task is not in progress';
  end if;
  if nullif(trim(p_caption), '') is null and coalesce(array_length(p_files, 1), 0) = 0 then
    raise exception 'deliverable is empty';
  end if;
  -- Файлы должны лежать в папке этой задачи.
  if exists (select 1 from unnest(p_files) f where f not like p_task_id::text || '/%') then
    raise exception 'file outside task folder';
  end if;

  insert into public.deliverables (task_id, version, caption, files, note, created_by)
  values (
    p_task_id,
    coalesce((select max(version) from public.deliverables where task_id = p_task_id), 0) + 1,
    nullif(trim(p_caption), ''),
    coalesce(p_files, '{}'),
    nullif(trim(p_note), ''),
    auth.uid()
  )
  returning id into v_id;

  update public.tasks set status = 'internal_review' where id = p_task_id;

  update public.orders o
     set status = 'in_progress'
   where o.id = v_task.order_id and o.status = 'paid';

  return v_id;
end;
$$;

-- Внутренняя проверка менеджером: одобрить → клиенту на согласование, иначе — на доработку.
create function public.review_task(p_task_id uuid, p_approve boolean, p_comment text default null)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'only managers can review tasks';
  end if;

  update public.tasks
     set status = case when p_approve then 'client_review' else 'in_progress' end::public.task_status
   where id = p_task_id and status = 'internal_review';
  if not found then
    raise exception 'task is not waiting for review';
  end if;

  if nullif(trim(p_comment), '') is not null then
    insert into public.task_comments (task_id, author_id, body)
    values (p_task_id, auth.uid(), trim(p_comment));
  end if;
end;
$$;

revoke execute on function public.assign_task, public.start_task, public.submit_deliverable, public.review_task
  from public, anon;
grant execute on function public.assign_task, public.start_task, public.submit_deliverable, public.review_task
  to authenticated;

-- RLS
alter table public.deliverables enable row level security;
alter table public.task_comments enable row level security;
alter table public.ai_generations enable row level security;

-- Версии создаются только через submit_deliverable.
create policy "deliverables: read"
  on public.deliverables for select
  using (public.can_view_task(task_id));

create policy "task_comments: read"
  on public.task_comments for select
  using (public.can_work_on_task(task_id));

create policy "task_comments: write"
  on public.task_comments for insert
  with check (author_id = auth.uid() and public.can_work_on_task(task_id));

-- Пишет только Edge Function ai-draft.
create policy "ai_generations: read"
  on public.ai_generations for select
  using (public.can_work_on_task(task_id));

-- Storage: приватный bucket для материалов, файлы лежат в папке <task_id>/.
insert into storage.buckets (id, name, public)
values ('deliverables', 'deliverables', false)
on conflict (id) do nothing;

create function public.task_id_from_path(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid
  end;
$$;

create policy "deliverables files: upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'deliverables'
    and public.can_work_on_task(public.task_id_from_path(name))
  );

create policy "deliverables files: read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'deliverables'
    and public.can_view_task(public.task_id_from_path(name))
  );
