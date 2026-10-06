-- Задачи команды: поручения людям от владельца и менеджеров («Снять десерты», «Обновить шаблон»).
-- Это та же таблица tasks, что и работа по заказам (kind = 'order'), но kind = 'team':
--   * название, описание (brief), важность, файлы к заданию, кто поставил;
--   * клиент (business_id) и заказ (related_order_id) — необязательно, только для справки;
--   * путь: новая → в работе → на проверке → готово (approved); к клиенту не попадает никогда.
--
-- Клиент видит задачи, версии и файлы только через tasks.order_id своего заказа. У задачи команды
-- order_id всегда пустой — заказ лежит в related_order_id, — а правила ниже дополнительно
-- проверяют kind = 'order'. Поэтому клиент не видит задачу команды, даже если она про его заказ;
-- и заказ не «ждёт» её, чтобы стать выполненным.

alter table public.tasks
  add column kind text not null default 'order' check (kind in ('order', 'team')),
  add column title text check (length(title) <= 200),
  add column priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  add column attachments text[] not null default '{}',
  add column created_by uuid references public.profiles (id) on delete set null,
  add column related_order_id uuid references public.orders (id) on delete set null;

alter table public.tasks
  alter column order_id drop not null,
  alter column business_id drop not null,
  alter column service_id drop not null,
  alter column number drop not null;

alter table public.tasks add constraint tasks_kind_fields check (
  case kind
    when 'order' then order_id is not null and business_id is not null and service_id is not null
      and number is not null and related_order_id is null
    else order_id is null and service_id is null and number is null and nullif(trim(title), '') is not null
  end
);

-- Номера задач уникальны только внутри заказа (иначе задачи команды с пустыми полями совпали бы).
drop index public.tasks_unique_number;
create unique index tasks_unique_number
  on public.tasks (order_id, service_id, platform_id, number) nulls not distinct
  where kind = 'order';
create index tasks_kind_status_idx on public.tasks (kind, status);

-- ---------- Клиент видит только работу по своим заказам ----------

drop policy "tasks: read" on public.tasks;
create policy "tasks: read"
  on public.tasks for select
  using (
    public.is_team()
    or assignee_id = auth.uid()
    or (
      kind = 'order'
      and exists (select 1 from public.orders o where o.id = order_id and o.client_id = auth.uid())
    )
  );

create or replace function public.can_view_task(p_task_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.can_work_on_task(p_task_id)
    or exists (
      select 1 from public.tasks t
      join public.orders o on o.id = t.order_id
      where t.id = p_task_id and t.kind = 'order' and o.client_id = auth.uid()
    );
$$;

drop policy "deliverables: read" on public.deliverables;
create policy "deliverables: read"
  on public.deliverables for select
  using (
    public.can_work_on_task(task_id)
    or (
      sent_to_client_at is not null
      and exists (
        select 1 from public.tasks t
        join public.orders o on o.id = t.order_id
        where t.id = task_id and t.kind = 'order' and o.client_id = auth.uid()
      )
    )
  );

create or replace function public.client_can_read_file(p_name text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.deliverables d
    join public.tasks t on t.id = d.task_id
    join public.orders o on o.id = t.order_id
    where d.task_id = public.task_id_from_path(p_name)
      and t.kind = 'order'
      and d.sent_to_client_at is not null
      and p_name = any (d.files)
      and o.client_id = auth.uid()
  );
$$;

-- Публикуются только материалы заказов.
create or replace function public.can_publish_task(p_task_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    join public.orders o on o.id = t.order_id
    where t.id = p_task_id
      and t.kind = 'order'
      and case
        when o.publishing = 'client' then o.client_id = auth.uid() or public.is_team()
        else public.is_team()
      end
  );
$$;

-- ---------- Создание и изменение задач команды ----------

-- Клиент задачи: по заказу (тогда бизнес — бизнес заказа) или просто бизнес. Возвращает business_id.
create function public.team_task_business(p_business_id uuid, p_order_id uuid)
returns uuid
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  v_business uuid;
begin
  if p_order_id is not null then
    select business_id into v_business from public.orders where id = p_order_id;
    if not found then
      raise exception 'order not found';
    end if;
    if p_business_id is not null and p_business_id <> v_business then
      raise exception 'order belongs to another client';
    end if;
    return v_business;
  end if;
  if p_business_id is not null and not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'client not found';
  end if;
  return p_business_id;
end;
$$;

create function public.check_team_assignee(p_assignee_id uuid)
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
end;
$$;

create function public.create_team_task(
  p_title text,
  p_description text default null,
  p_assignee_id uuid default null,
  p_due_date date default null,
  p_priority text default 'normal',
  p_business_id uuid default null,
  p_order_id uuid default null
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_manager() then
    raise exception 'only managers can create team tasks';
  end if;
  if nullif(trim(p_title), '') is null then
    raise exception 'title is required';
  end if;
  perform public.check_team_assignee(p_assignee_id);

  insert into public.tasks (
    kind, title, brief, assignee_id, due_date, priority, business_id, related_order_id, created_by, status
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
    case when p_assignee_id is null then 'new' else 'assigned' end::public.task_status
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Все поля сразу, как на экране редактирования. Исполнителя можно сменить и в работе.
create function public.update_team_task(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_assignee_id uuid,
  p_due_date date,
  p_priority text,
  p_business_id uuid default null,
  p_order_id uuid default null
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

  update public.tasks
     set title = trim(p_title),
         brief = nullif(trim(p_description), ''),
         assignee_id = p_assignee_id,
         due_date = p_due_date,
         priority = coalesce(p_priority, 'normal'),
         business_id = public.team_task_business(p_business_id, p_order_id),
         related_order_id = p_order_id,
         status = case
           when status = 'new' and p_assignee_id is not null then 'assigned'::public.task_status
           when status = 'assigned' and p_assignee_id is null then 'new'::public.task_status
           else status
         end
   where id = p_task_id and kind = 'team';
  if not found then
    raise exception 'task not found';
  end if;
end;
$$;

-- Файлы к заданию лежат в папке задачи (bucket deliverables, <task_id>/...), как и версии.
create function public.set_team_task_attachments(p_task_id uuid, p_files text[])
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'only managers can change team tasks';
  end if;
  if exists (select 1 from unnest(p_files) f where f not like p_task_id::text || '/%') then
    raise exception 'file outside task folder';
  end if;
  update public.tasks set attachments = coalesce(p_files, '{}') where id = p_task_id and kind = 'team';
  if not found then
    raise exception 'task not found';
  end if;
end;
$$;

create function public.delete_team_task(p_task_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'only managers can delete team tasks';
  end if;
  delete from public.tasks where id = p_task_id and kind = 'team';
  if not found then
    raise exception 'task not found';
  end if;
end;
$$;

-- Проверка: у задачи команды «принять» — сразу «Готово», клиенту ничего не отправляется.
-- Вернуть задачу команды можно только с комментарием — что исправить.
create or replace function public.review_task(p_task_id uuid, p_approve boolean, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  if not public.is_manager() then
    raise exception 'only managers can review tasks';
  end if;

  select kind into v_kind from public.tasks where id = p_task_id;
  if v_kind = 'team' and not p_approve and nullif(trim(p_comment), '') is null then
    raise exception 'comment is required to return the task';
  end if;

  update public.tasks
     set status = case
       when not p_approve then 'in_progress'
       when kind = 'team' then 'approved'
       else 'client_review'
     end::public.task_status
   where id = p_task_id and status = 'internal_review';
  if not found then
    raise exception 'task is not waiting for review';
  end if;

  if p_approve then
    update public.deliverables
       set sent_to_client_at = case when v_kind = 'order' then now() else sent_to_client_at end,
           reviewed_by = auth.uid(),
           reviewer_name = (select coalesce(nullif(trim(full_name), ''), email) from public.profiles where id = auth.uid())
     where id = (
       select id from public.deliverables where task_id = p_task_id order by version desc limit 1
     );
  end if;

  if nullif(trim(p_comment), '') is not null then
    insert into public.task_comments (task_id, author_id, body)
    values (p_task_id, auth.uid(), trim(p_comment));
  end if;
end;
$$;

revoke execute on function public.team_task_business, public.check_team_assignee from public, anon, authenticated;
revoke execute on function public.create_team_task, public.update_team_task, public.set_team_task_attachments,
  public.delete_team_task from public, anon;
grant execute on function public.create_team_task, public.update_team_task, public.set_team_task_attachments,
  public.delete_team_task to authenticated;
