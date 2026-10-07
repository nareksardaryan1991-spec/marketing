-- Задачи команды: участники и «Кто видит».
--
-- В задаче трое: автор (created_by), исполнитель (assignee_id) и проверяющий (reviewer_id — по умолчанию
-- автор). Остальные видят задачу, только если отмечены в «Кто видит» (task_watchers). Владелец видит все.
-- Раньше задачи команды видела вся штатная команда (is_team) — теперь только эти люди, менеджеры тоже.
-- Работа по заказам (kind = 'order') не меняется.
--
-- Все правила чтения (задача, версии, заметки, комментарии, файлы, запуски агентов, пожелания к заказу)
-- идут через can_work_on_task / can_view_task, поэтому новое правило задано там — в одном месте.

alter table public.tasks
  add column reviewer_id uuid references public.profiles (id) on delete set null;

-- У задач, поставленных раньше, принимает работу автор.
update public.tasks set reviewer_id = created_by where kind = 'team';

create table public.task_watchers (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (task_id, user_id)
);
create index task_watchers_user_id_idx on public.task_watchers (user_id);
alter table public.task_watchers enable row level security;

create function public.is_task_watcher(p_task_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (select 1 from public.task_watchers where task_id = p_task_id and user_id = auth.uid());
$$;

-- Кто видит задачу команды: владелец, автор, исполнитель, проверяющий и отмеченные.
create function public.sees_team_task(p_task public.tasks)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select p_task.kind = 'team' and auth.uid() is not null and (
    public.is_admin()
    or auth.uid() in (p_task.created_by, p_task.assignee_id, p_task.reviewer_id)
    or public.is_task_watcher(p_task.id)
  );
$$;

-- Работа по заказу — штатная команда и исполнитель; задача команды — только те, кто её видит.
create or replace function public.can_work_on_task(p_task_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and case
        when t.kind = 'team' then public.sees_team_task(t)
        else public.is_team() or t.assignee_id = auth.uid()
      end
  );
$$;

drop policy "tasks: read" on public.tasks;
create policy "tasks: read"
  on public.tasks for select
  using (
    case
      when kind = 'team' then public.sees_team_task(tasks)
      else public.is_team()
        or assignee_id = auth.uid()
        or exists (select 1 from public.orders o where o.id = order_id and o.client_id = auth.uid())
    end
  );

-- Задачи меняются только функциями (у каждой свои проверки). Прямое изменение строки менеджером
-- обходило их — например, позволяло переписать чужую задачу команды.
drop policy "tasks: manager updates" on public.tasks;

-- Список «Кто видит» — тем, кто видит задачу. Меняется только функциями.
create policy "task_watchers: read"
  on public.task_watchers for select
  using (public.can_work_on_task(task_id));

-- ---------- Исполнитель, проверяющий, «Кто видит» ----------

-- Исполнитель и проверяющий — люди команды. Владельца назначает только сам владелец.
create or replace function public.check_team_assignee(p_assignee_id uuid)
returns void
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if p_assignee_id is not null and not exists (
    select 1 from public.profiles where id = p_assignee_id and public.is_employee_role(role)
  ) then
    raise exception 'assignee must be a team member';
  end if;
  if not public.is_admin() and exists (select 1 from public.profiles where id = p_assignee_id and role = 'admin') then
    raise exception 'only the owner can give a task to the owner';
  end if;
end;
$$;

-- «Кто видит»: только люди команды, без повторов и без владельца (он видит всё и так).
create function public.set_task_watchers(p_task_id uuid, p_watchers uuid[])
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from unnest(p_watchers) w
    where not exists (select 1 from public.profiles where id = w and public.is_employee_role(role))
  ) then
    raise exception 'watchers must be team members';
  end if;
  delete from public.task_watchers where task_id = p_task_id;
  insert into public.task_watchers (task_id, user_id)
  select distinct p_task_id, w
  from unnest(p_watchers) w
  join public.profiles p on p.id = w
  where p.role <> 'admin';
end;
$$;

drop function public.create_team_task(text, text, uuid, date, text, uuid, uuid, uuid);

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
  p_watchers uuid[] default '{}'
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
    from_agent_run_id, draft_agent, reviewer_id
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
    coalesce(p_reviewer_id, auth.uid())
  )
  returning id into v_id;
  perform public.set_task_watchers(v_id, coalesce(p_watchers, '{}'));
  return v_id;
end;
$$;

-- Все поля сразу, как на экране редактирования. Исполнителя можно сменить и в работе.
-- Проверяющий и «Кто видит» не переданы (null) — остаются прежними.
drop function public.update_team_task(uuid, text, text, uuid, date, text, uuid, uuid);

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
  p_watchers uuid[] default null
)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'only managers can change team tasks';
  end if;
  if nullif(trim(p_title), '') is null then
    raise exception 'title is required';
  end if;
  perform public.check_team_assignee(p_assignee_id);
  perform public.check_team_assignee(p_reviewer_id);

  update public.tasks
     set title = trim(p_title),
         brief = nullif(trim(p_description), ''),
         assignee_id = p_assignee_id,
         due_date = p_due_date,
         priority = coalesce(p_priority, 'normal'),
         business_id = public.team_task_business(p_business_id, p_order_id),
         related_order_id = p_order_id,
         reviewer_id = coalesce(p_reviewer_id, reviewer_id),
         status = case
           when status = 'new' and p_assignee_id is not null then 'assigned'::public.task_status
           when status = 'assigned' and p_assignee_id is null then 'new'::public.task_status
           else status
         end
   where id = p_task_id and kind = 'team';
  if not found then
    raise exception 'task not found';
  end if;
  if p_watchers is not null then
    perform public.set_task_watchers(p_task_id, p_watchers);
  end if;
end;
$$;

-- sees_team_task и is_task_watcher вызывает правило чтения задач — они отвечают только про себя (auth.uid()).
revoke execute on function public.is_task_watcher, public.sees_team_task from public, anon;
grant execute on function public.is_task_watcher, public.sees_team_task to authenticated;
revoke execute on function public.set_task_watchers from public, anon, authenticated;
revoke execute on function public.create_team_task, public.update_team_task from public, anon;
grant execute on function public.create_team_task, public.update_team_task to authenticated;
