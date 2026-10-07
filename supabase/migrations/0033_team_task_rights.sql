-- Задачи команды: кто что может.
--   * Автор и владелец — название, описание, срок, важность, клиент, исполнитель, проверяющий, «Кто видит»,
--     файлы к заданию, удаление. Другой менеджер — ничего, даже если видит задачу.
--   * Исполнитель — «в работе» (start_task), сдать результат на проверку (submit_deliverable), комментарии.
--     Только он: ни менеджер, ни AI-агент от имени другого человека результат за него не сдают.
--   * Проверяющий (и владелец) — принять или вернуть с комментарием (review_task).
--   * Комментарии пишут все, кто видит задачу (правило task_comments из 0003 через can_work_on_task).
-- Работа по заказам (kind = 'order') — по-прежнему: менеджеры назначают, проверяют и сдают.

-- Менять задачу команды может автор (пока он менеджер) и владелец.
create function public.can_edit_team_task(p_task public.tasks)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select p_task.kind = 'team' and (
    public.is_admin() or (p_task.created_by = auth.uid() and public.is_manager())
  );
$$;

-- Задача команды для изменения: не видна — «не найдена», видна, но чужая — отказ.
create function public.team_task_for_edit(p_task_id uuid)
returns public.tasks
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
  if not public.can_edit_team_task(v_task) then
    raise exception 'only the author or the owner can change the task';
  end if;
  return v_task;
end;
$$;

create or replace function public.update_team_task(
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
  perform public.team_task_for_edit(p_task_id);
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
   where id = p_task_id;
  if p_watchers is not null then
    perform public.set_task_watchers(p_task_id, p_watchers);
  end if;
end;
$$;

create or replace function public.set_team_task_attachments(p_task_id uuid, p_files text[])
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  perform public.team_task_for_edit(p_task_id);
  if exists (select 1 from unnest(p_files) f where f not like p_task_id::text || '/%') then
    raise exception 'file outside task folder';
  end if;
  update public.tasks set attachments = coalesce(p_files, '{}') where id = p_task_id;
end;
$$;

create or replace function public.delete_team_task(p_task_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  perform public.team_task_for_edit(p_task_id);
  delete from public.tasks where id = p_task_id;
end;
$$;

-- Назначение с доски — только работа по заказам. Задачу команды меняет update_team_task.
create or replace function public.assign_task(
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
    select 1 from public.profiles where id = p_assignee_id and public.is_employee_role(role)
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
   where id = p_task_id and kind = 'order';
  if not found then
    raise exception 'task not found';
  end if;
end;
$$;

-- Результат задачи команды сдаёт только исполнитель. Работу по заказу — исполнитель или менеджер.
create or replace function public.submit_deliverable(
  p_task_id uuid,
  p_caption text,
  p_files text[] default '{}',
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_id uuid;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or not (
    v_task.assignee_id = auth.uid() or (v_task.kind = 'order' and public.is_manager())
  ) then
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

  insert into public.deliverables (task_id, version, caption, files, created_by)
  values (
    p_task_id,
    coalesce((select max(version) from public.deliverables where task_id = p_task_id), 0) + 1,
    nullif(trim(p_caption), ''),
    coalesce(p_files, '{}'),
    auth.uid()
  )
  returning id into v_id;

  if nullif(trim(p_note), '') is not null then
    insert into public.deliverable_notes (deliverable_id, task_id, note) values (v_id, p_task_id, trim(p_note));
  end if;

  update public.tasks set status = 'internal_review' where id = p_task_id;

  update public.orders o
     set status = 'in_progress'
   where o.id = v_task.order_id and o.status = 'paid';

  return v_id;
end;
$$;

-- Версия от AI-агента (вызывает только Edge Function ai-agent): в задачу команды — только если агента
-- запустил её исполнитель.
create or replace function public.submit_agent_deliverable(
  p_task_id uuid,
  p_by uuid,
  p_agent text,
  p_caption text,
  p_files text[] default '{}',
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_id uuid;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or (v_task.kind = 'team' and v_task.assignee_id is distinct from p_by) then
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

  insert into public.deliverables (task_id, version, caption, files, created_by, agent)
  values (
    p_task_id,
    coalesce((select max(version) from public.deliverables where task_id = p_task_id), 0) + 1,
    nullif(trim(p_caption), ''),
    coalesce(p_files, '{}'),
    p_by,
    p_agent
  )
  returning id into v_id;

  if nullif(trim(p_note), '') is not null then
    insert into public.deliverable_notes (deliverable_id, task_id, note) values (v_id, p_task_id, trim(p_note));
  end if;

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

-- Проверка: задачу команды принимает или возвращает проверяющий (или владелец), работу по заказу — менеджер.
-- Комментарий проверки пишется до смены статуса — чтобы уведомление о возврате пришло вместе с ним.
create or replace function public.review_task(p_task_id uuid, p_approve boolean, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or not (
    case
      when v_task.kind = 'team' then public.sees_team_task(v_task)
        and (v_task.reviewer_id = auth.uid() or public.is_admin())
      else public.is_manager()
    end
  ) then
    raise exception 'only the reviewer can review this task';
  end if;
  if v_task.status <> 'internal_review' then
    raise exception 'task is not waiting for review';
  end if;
  if v_task.kind = 'team' and not p_approve and nullif(trim(p_comment), '') is null then
    raise exception 'comment is required to return the task';
  end if;

  if nullif(trim(p_comment), '') is not null then
    insert into public.task_comments (task_id, author_id, body)
    values (p_task_id, auth.uid(), trim(p_comment));
  end if;

  update public.tasks
     set status = case
       when not p_approve then 'in_progress'
       when kind = 'team' then 'approved'
       else 'client_review'
     end::public.task_status
   where id = p_task_id;

  if p_approve then
    update public.deliverables
       set sent_to_client_at = case when v_task.kind = 'order' then now() else sent_to_client_at end,
           reviewed_by = auth.uid(),
           reviewer_name = (select coalesce(nullif(trim(full_name), ''), email) from public.profiles where id = auth.uid())
     where id = (
       select id from public.deliverables where task_id = p_task_id order by version desc limit 1
     );
  end if;
end;
$$;

-- Файлы в папку задачи команды кладут автор и владелец (файлы к заданию) и исполнитель (результат).
-- Проверяющий и отмеченные только смотрят. Папка работы по заказу — как раньше.
create function public.can_upload_task_file(p_task_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and case
        when t.kind = 'team' then public.can_edit_team_task(t) or t.assignee_id = auth.uid()
        else public.is_team() or t.assignee_id = auth.uid()
      end
  );
$$;

drop policy "deliverables files: upload" on storage.objects;
create policy "deliverables files: upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'deliverables'
    and public.can_upload_task_file(public.task_id_from_path(name))
  );

revoke execute on function public.can_edit_team_task, public.can_upload_task_file from public, anon;
grant execute on function public.can_edit_team_task, public.can_upload_task_file to authenticated;
revoke execute on function public.team_task_for_edit from public, anon, authenticated;
