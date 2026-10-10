-- Задачи команды как трекер: проекты, теги, смена статуса с доски, менеджеры видят все задачи команды.
--
--   * Видимость: владелец и все менеджеры видят все задачи команды. Остальные — как раньше: автор, исполнитель,
--     проверяющий и отмеченные в «Кто видит». Права не меняются: править и удалять — автор и владелец,
--     сдавать — исполнитель, принимать — проверяющий. Правило задано в user_sees_team_task — через него идут
--     чтение задачи, версий, комментариев, файлов, истории и защитная сетка уведомлений.
--   * Проекты (team_projects): клиент или направление работы. Заводит, переименовывает, убирает в архив и
--     удаляет только владелец; видят все сотрудники агентства. У задачи — необязательный project_id.
--   * Теги: до 10 коротких слов у задачи (tasks.tags), без «#», строчными, без повторов.
--   * Статус с доски (set_team_task_status): «Бэклог» (new), «К работе» (assigned), «В работе» (in_progress).
--     «На проверке» — только сдачей результата (submit_deliverable), «Готово» — только проверкой (review_task).
--     Автор и владелец двигают задачу между первыми тремя колонками и открывают заново готовую;
--     исполнитель — между «К работе» и «В работе».

-- ---------- Видимость: менеджеры видят все задачи команды ----------

create or replace function public.user_sees_team_task(p_task public.tasks, p_user uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select p_task.kind = 'team' and p_user is not null and (
    p_user in (p_task.created_by, p_task.assignee_id, p_task.reviewer_id)
    or exists (select 1 from public.task_watchers where task_id = p_task.id and user_id = p_user)
    or exists (select 1 from public.profiles where id = p_user and role in ('admin', 'manager'))
  );
$$;

-- ---------- Проекты ----------

create table public.team_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  archived boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index team_projects_name_idx on public.team_projects (lower(trim(name)));
alter table public.team_projects enable row level security;

create function public.trim_team_project_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := trim(new.name);
  return new;
end;
$$;

create trigger team_projects_trim_name
  before insert or update of name on public.team_projects
  for each row execute function public.trim_team_project_name();

create policy "team_projects: staff read"
  on public.team_projects for select
  using (coalesce(public.is_employee_role(public.my_role()), false));

create policy "team_projects: owner adds"
  on public.team_projects for insert
  with check (public.is_admin());

create policy "team_projects: owner changes"
  on public.team_projects for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "team_projects: owner deletes"
  on public.team_projects for delete
  using (public.is_admin());

-- ---------- Проект и теги у задачи ----------

alter table public.tasks
  add column project_id uuid references public.team_projects (id) on delete set null,
  add column tags text[] not null default '{}' check (cardinality(tags) <= 10);
alter table public.tasks add constraint tasks_team_fields check (
  kind = 'team' or (project_id is null and tags = '{}')
);
create index tasks_project_id_idx on public.tasks (project_id) where project_id is not null;

-- Теги: без «#» и пробелов по краям, строчными, без пустых и повторов, в порядке ввода.
create function public.clean_task_tags(p_tags text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_tags text[];
begin
  select coalesce(array_agg(tag order by first_pos), '{}') into v_tags
  from (
    select lower(trim(ltrim(trim(t), '#'))) as tag, min(pos) as first_pos
    from unnest(coalesce(p_tags, '{}')) with ordinality as u (t, pos)
    group by 1
  ) s
  where tag <> '';
  if cardinality(v_tags) > 10 then
    raise exception 'too many tags';
  end if;
  if exists (select 1 from unnest(v_tags) tag where length(tag) > 30) then
    raise exception 'tag is too long';
  end if;
  return v_tags;
end;
$$;

-- В задачу — только действующий проект (архивный остаётся, если он уже стоит в задаче).
create function public.check_team_project(p_project_id uuid, p_current uuid default null)
returns void
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if p_project_id is not null and p_project_id is distinct from p_current and not exists (
    select 1 from public.team_projects where id = p_project_id and not archived
  ) then
    raise exception 'project not found';
  end if;
end;
$$;

drop function public.create_team_task(text, text, uuid, date, text, uuid, uuid, uuid, uuid, uuid[]);

create function public.create_team_task(
  p_title text,
  p_description text default null,
  p_assignee_id uuid default null,
  p_due_date date default null,
  p_priority text default 'normal',
  p_business_id uuid default null,
  p_order_id uuid default null,
  p_from_run_id uuid default null,
  p_reviewer_id uuid default null,
  p_watchers uuid[] default '{}',
  p_project_id uuid default null,
  p_tags text[] default '{}'
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_agent text;
begin
  if not public.is_manager() then
    raise exception 'only managers can create team tasks';
  end if;
  if nullif(trim(p_title), '') is null then
    raise exception 'title is required';
  end if;
  perform public.check_team_assignee(p_assignee_id);
  perform public.check_team_assignee(p_reviewer_id);
  perform public.check_team_project(p_project_id);
  if p_from_run_id is not null then
    -- Передать можно готовую работу агента-исполнителя (не план менеджер-агента).
    select agent into v_agent from public.agent_runs
     where id = p_from_run_id and agent <> 'manager' and status in ('done', 'applied');
    if not found then
      raise exception 'agent work not found';
    end if;
  end if;

  insert into public.tasks (
    kind, title, brief, assignee_id, due_date, priority, business_id, related_order_id, created_by, status,
    from_agent_run_id, draft_agent, reviewer_id, project_id, tags
  )
  values (
    'team',
    trim(p_title),
    nullif(trim(p_description), ''),
    p_assignee_id,
    p_due_date,
    coalesce(p_priority, 'normal'),
    public.team_task_business(p_business_id, p_order_id),
    p_order_id,
    auth.uid(),
    case when p_assignee_id is null then 'new' else 'assigned' end::public.task_status,
    p_from_run_id,
    v_agent,
    coalesce(p_reviewer_id, auth.uid()),
    p_project_id,
    public.clean_task_tags(p_tags)
  )
  returning id into v_id;
  perform public.set_task_watchers(v_id, coalesce(p_watchers, '{}'));
  return v_id;
end;
$$;

-- Все поля сразу, как на экране редактирования. Проверяющий и «Кто видит» не переданы (null) — остаются
-- прежними. Теги не переданы (null; так зовёт приложение без проектов) — остаются прежними и теги, и проект;
-- переданы (хотя бы пустые) — проект ставится как передан, null убирает его.
drop function public.update_team_task(uuid, text, text, uuid, date, text, uuid, uuid, uuid, uuid[]);

create function public.update_team_task(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_assignee_id uuid,
  p_due_date date,
  p_priority text,
  p_business_id uuid default null,
  p_order_id uuid default null,
  p_reviewer_id uuid default null,
  p_watchers uuid[] default null,
  p_project_id uuid default null,
  p_tags text[] default null
)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_task public.tasks := public.team_task_for_edit(p_task_id);
begin
  if nullif(trim(p_title), '') is null then
    raise exception 'title is required';
  end if;
  -- Проверяем только смену: если владелец сам взял задачу, автор по-прежнему может её править.
  if p_assignee_id is distinct from v_task.assignee_id then
    perform public.check_team_assignee(p_assignee_id);
  end if;
  if p_reviewer_id is distinct from v_task.reviewer_id then
    perform public.check_team_assignee(p_reviewer_id);
  end if;
  if p_tags is not null then
    perform public.check_team_project(p_project_id, v_task.project_id);
  end if;

  update public.tasks
     set title = trim(p_title),
         brief = nullif(trim(p_description), ''),
         assignee_id = p_assignee_id,
         due_date = p_due_date,
         priority = coalesce(p_priority, 'normal'),
         business_id = public.team_task_business(p_business_id, p_order_id),
         related_order_id = p_order_id,
         reviewer_id = coalesce(p_reviewer_id, reviewer_id),
         project_id = case when p_tags is null then project_id else p_project_id end,
         tags = case when p_tags is null then tags else public.clean_task_tags(p_tags) end,
         -- Исполнителя назначили впервые — задача из бэклога идёт «К работе»; убрали — обратно в бэклог.
         -- Задача, которую с исполнителем вернули в бэклог, там и остаётся.
         status = case
           when status = 'new' and p_assignee_id is not null and v_task.assignee_id is null
             then 'assigned'::public.task_status
           when status = 'assigned' and p_assignee_id is null then 'new'::public.task_status
           else status
         end
   where id = p_task_id;
  if p_watchers is not null then
    perform public.set_task_watchers(p_task_id, p_watchers);
  end if;
end;
$$;

-- ---------- Статус с доски ----------

create function public.set_team_task_status(p_task_id uuid, p_status public.task_status)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id and kind = 'team' for update;
  if not found or not public.sees_team_task(v_task) then
    raise exception 'task not found';
  end if;
  if v_task.status = p_status then
    return;
  end if;
  if p_status not in ('new', 'assigned', 'in_progress') then
    raise exception 'review and done are set by submitting and reviewing';
  end if;
  if p_status <> 'new' and v_task.assignee_id is null then
    raise exception 'task has no assignee';
  end if;

  if public.can_edit_team_task(v_task) then
    if v_task.status not in ('new', 'assigned', 'in_progress', 'approved') then
      raise exception 'task is waiting for review';
    end if;
  elsif v_task.assignee_id = auth.uid() then
    if v_task.status not in ('assigned', 'in_progress') or p_status = 'new' then
      raise exception 'the assignee moves the task only between to do and in progress';
    end if;
  else
    raise exception 'only the author, the owner or the assignee can move the task';
  end if;

  update public.tasks set status = p_status where id = p_task_id;
end;
$$;

-- ---------- История: проект и теги ----------

create or replace function public.log_team_task()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_field text;
begin
  if tg_op = 'INSERT' then
    insert into public.task_history (task_id, actor_id, field, new_value)
    values (new.id, auth.uid(), 'created', to_jsonb(new.title));
    return new;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach v_field in array array[
    'title', 'brief', 'due_date', 'priority', 'status', 'assignee_id', 'reviewer_id', 'related_order_id', 'attachments',
    'tags'
  ] loop
    if v_old -> v_field is distinct from v_new -> v_field then
      insert into public.task_history (task_id, actor_id, field, old_value, new_value)
      values (new.id, auth.uid(), v_field, v_old -> v_field, v_new -> v_field);
    end if;
  end loop;
  if old.business_id is distinct from new.business_id then
    insert into public.task_history (task_id, actor_id, field, old_value, new_value)
    values (
      new.id, auth.uid(), 'business',
      to_jsonb((select name from public.businesses where id = old.business_id)),
      to_jsonb((select name from public.businesses where id = new.business_id))
    );
  end if;
  -- Проект — названием: проект могут переименовать или удалить, а история должна читаться.
  -- Удалённого проекта уже нет (null → null) — эту запись сделал log_team_project_deleted.
  if old.project_id is distinct from new.project_id then
    v_old := to_jsonb((select name from public.team_projects where id = old.project_id));
    v_new := to_jsonb((select name from public.team_projects where id = new.project_id));
    if v_old is distinct from v_new then
      insert into public.task_history (task_id, actor_id, field, old_value, new_value)
      values (new.id, auth.uid(), 'project', v_old, v_new);
    end if;
  end if;
  return new;
end;
$$;

-- Удалённый проект: строки задач меняет внешний ключ (set null), его название берём до удаления.
create function public.log_team_project_deleted()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.task_history (task_id, actor_id, field, old_value, new_value)
  select id, auth.uid(), 'project', to_jsonb(old.name), null
    from public.tasks where project_id = old.id;
  return old;
end;
$$;

create trigger team_projects_log_delete
  before delete on public.team_projects
  for each row execute function public.log_team_project_deleted();

revoke execute on function public.check_team_project, public.log_team_project_deleted, public.trim_team_project_name
  from public, anon, authenticated;
revoke execute on function public.create_team_task, public.update_team_task, public.set_team_task_status
  from public, anon;
grant execute on function public.create_team_task, public.update_team_task, public.set_team_task_status
  to authenticated;
