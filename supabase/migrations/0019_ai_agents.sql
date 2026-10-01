-- AI-агенты по ролям: сотрудник поручает задачу агенту, агент делает версию и отправляет
-- её менеджеру на проверку. К клиенту — только после проверки человеком.

-- Какой агент сделал версию (null — человек).
alter table public.deliverables add column agent text;

-- Запуск агента: по задаче, по заказу (менеджер) или свободный запрос из чата с агентом
-- (тогда задачи нет, instructions — текст запроса, result — { text, files }).
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks (id) on delete cascade,
  -- Менеджер-агент работает с заказом целиком.
  order_id uuid references public.orders (id) on delete cascade,
  agent text not null check (agent in (
    'copywriter', 'designer', 'smm', 'video', 'photographer', 'targetologist', 'seo', 'manager'
  )),
  status text not null default 'running' check (status in ('running', 'done', 'failed', 'applied')),
  -- Запрос из чата с агентом (остаётся в чате, даже если результат потом отправили в задачу).
  chat boolean not null default false,
  instructions text,
  deliverable_id uuid references public.deliverables (id) on delete set null,
  -- Предложение менеджер-агента (брифы, исполнители, сроки) — применяется по кнопке.
  result jsonb,
  error text,
  input_tokens integer,
  output_tokens integer,
  images integer not null default 0,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index agent_runs_task_id_idx on public.agent_runs (task_id);
create index agent_runs_created_by_idx on public.agent_runs (created_by, created_at desc);

-- Пишет только Edge Function ai-agent (service role).
alter table public.agent_runs enable row level security;

create policy "agent_runs: read"
  on public.agent_runs for select
  using (
    created_by = auth.uid()
    or public.is_manager()
    or (task_id is not null and public.can_work_on_task(task_id))
  );

-- Картинки из чата с агентом: <user_id>/<run_id>-N.png. Читает автор и менеджеры, пишет сервер.
insert into storage.buckets (id, name, public)
values ('agent-files', 'agent-files', false)
on conflict (id) do nothing;

create policy "agent-files: read own or manager"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'agent-files'
    and (split_part(name, '/', 1) = auth.uid()::text or public.is_manager())
  );

-- Версия от агента. Права запустившего (исполнитель или менеджер) проверяет Edge Function;
-- здесь — те же правила задачи, что и у submit_deliverable.
create function public.submit_agent_deliverable(
  p_task_id uuid,
  p_by uuid,
  p_agent text,
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
  if not found then
    raise exception 'task not found';
  end if;
  if v_task.status not in ('new', 'assigned', 'in_progress', 'changes_requested') then
    raise exception 'task is not in progress';
  end if;
  if nullif(trim(p_caption), '') is null and coalesce(array_length(p_files, 1), 0) = 0 then
    raise exception 'deliverable is empty';
  end if;
  if exists (select 1 from unnest(p_files) f where f not like p_task_id::text || '/%') then
    raise exception 'file outside task folder';
  end if;

  insert into public.deliverables (task_id, version, caption, files, note, created_by, agent)
  values (
    p_task_id,
    coalesce((select max(version) from public.deliverables where task_id = p_task_id), 0) + 1,
    nullif(trim(p_caption), ''),
    coalesce(p_files, '{}'),
    nullif(trim(p_note), ''),
    p_by,
    p_agent
  )
  returning id into v_id;

  -- У задачи без исполнителя ответственным становится тот, кто запустил агента.
  update public.tasks
     set status = 'internal_review',
         assignee_id = coalesce(assignee_id, p_by)
   where id = p_task_id;

  update public.orders o
     set status = 'in_progress'
   where o.id = v_task.order_id and o.status = 'paid';

  return v_id;
end;
$$;

revoke execute on function public.submit_agent_deliverable from public, anon, authenticated;
grant execute on function public.submit_agent_deliverable to service_role;

-- Применить предложение менеджер-агента. Каждый пункт — через assign_task, с его проверками.
create function public.apply_manager_plan(p_run_id uuid)
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  v_run public.agent_runs;
  v_item jsonb;
  v_task public.tasks;
  v_count integer := 0;
begin
  if not public.is_manager() then
    raise exception 'only managers can apply the plan';
  end if;
  select * into v_run from public.agent_runs where id = p_run_id for update;
  if not found or v_run.agent <> 'manager' or v_run.status <> 'done' then
    raise exception 'plan not found';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(v_run.result -> 'tasks', '[]'::jsonb)) loop
    select * into v_task from public.tasks
     where id = (v_item ->> 'task_id')::uuid and order_id = v_run.order_id;
    -- Задачи, которые уже в работе у людей, не трогаем.
    if found and v_task.status in ('new', 'assigned') then
      perform public.assign_task(
        v_task.id,
        coalesce(nullif(v_item ->> 'assignee_id', '')::uuid, v_task.assignee_id),
        coalesce(nullif(v_item ->> 'due_date', '')::date, v_task.due_date),
        coalesce(nullif(v_item ->> 'brief', ''), v_task.brief)
      );
      v_count := v_count + 1;
    end if;
  end loop;

  update public.agent_runs set status = 'applied' where id = p_run_id;
  return v_count;
end;
$$;

revoke execute on function public.apply_manager_plan from public, anon;
grant execute on function public.apply_manager_plan to authenticated;
