-- «Передать человеку»: задача команды из работы AI-агента. Черновик (текст и файлы) прикрепляется
-- к задаче — текст в описании, файлы копирует приложение в папку задачи. Здесь запоминаем, из какой
-- работы задача и какой агент делал черновик: исполнитель запуски агентов не видит, а имя агента
-- в карточке задачи нужно.

alter table public.tasks
  add column from_agent_run_id uuid references public.agent_runs (id) on delete set null,
  add column draft_agent text;

drop function public.create_team_task(text, text, uuid, date, text, uuid, uuid);

create function public.create_team_task(
  p_title text,
  p_description text default null,
  p_assignee_id uuid default null,
  p_due_date date default null,
  p_priority text default 'normal',
  p_business_id uuid default null,
  p_order_id uuid default null,
  p_from_run_id uuid default null
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
    from_agent_run_id, draft_agent
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
    v_agent
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.create_team_task from public, anon;
grant execute on function public.create_team_task to authenticated;
