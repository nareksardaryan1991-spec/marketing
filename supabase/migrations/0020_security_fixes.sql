-- Проверка безопасности (этап 1).
--
-- 1. Заметка к версии материала («что сделал, допущения, вопросы» — для менеджера) лежала
--    в deliverables.note, а клиент читает отправленные ему версии целиком: через API он видел
--    и заметку. Права в Postgres не бывают «на поле для одной строки», поэтому заметки
--    переезжают в отдельную таблицу, которую видит только тот, кто работает с задачей.
-- 2. task_payload и manager_ids нужны только уведомлениям внутри базы, а вызвать их мог кто
--    угодно, даже без входа: task_payload по выдуманной строке задачи отдавал название чужого
--    бизнеса, manager_ids — id менеджеров.

create table public.deliverable_notes (
  deliverable_id uuid primary key references public.deliverables (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  note text not null check (length(trim(note)) > 0)
);

create index deliverable_notes_task_id_idx on public.deliverable_notes (task_id);

alter table public.deliverable_notes enable row level security;

create policy "deliverable_notes: read"
  on public.deliverable_notes for select
  using (public.can_work_on_task(task_id));

insert into public.deliverable_notes (deliverable_id, task_id, note)
select id, task_id, trim(note) from public.deliverables where nullif(trim(note), '') is not null;

alter table public.deliverables drop column note;

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

revoke execute on function public.task_payload, public.manager_ids from public, anon, authenticated;
grant execute on function public.task_payload, public.manager_ids to service_role;
