-- «Нагрузка команды» с задачами команды и с AI-агентами.
-- Люди: открытые задачи — и по заказам, и задачи команды (team_open — сколько из них задачи команды),
-- плюс должность. Агенты: сколько сейчас работают, сколько их версий ждут проверки, сделано за неделю.
-- Счётчики этапов: задачи команды входят в «без исполнителя», «в работе», «ждут проверки», «просрочено».

create or replace function public.owner_dashboard()
returns jsonb
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  v_today date := public.yerevan_today();
  v_month_start timestamptz := public.yerevan_day_start(date_trunc('month', v_today)::date);
  v_prev_start timestamptz := public.yerevan_day_start((date_trunc('month', v_today) - interval '1 month')::date);
  v_admin boolean := public.is_admin();
begin
  if not public.is_manager() then
    raise exception 'only managers can see the dashboard';
  end if;

  return jsonb_build_object(
    'is_admin', v_admin,
    -- Деньги видит только владелец.
    'revenue_month', case when v_admin then (
      select coalesce(sum(amount_amd), 0) from public.payments
      where status = 'succeeded' and updated_at >= v_month_start
    ) end,
    'revenue_prev_month', case when v_admin then (
      select coalesce(sum(amount_amd), 0) from public.payments
      where status = 'succeeded' and updated_at >= v_prev_start and updated_at < v_month_start
    ) end,
    'paid_orders_month', (
      select count(*) from public.orders where paid_at >= v_month_start
    ),
    'active_clients', (
      select count(distinct client_id) from public.orders where status in ('paid', 'in_progress')
    ),
    'orders', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select status, count(*) as n from public.orders group by status) s
    ),
    -- Этапы, общие для заказов и задач команды, считают обе; «у клиента» и «к публикации» — только заказы
    -- (у задачи команды approved — это «Готово»).
    'tasks', (
      select jsonb_build_object(
        'unassigned', count(*) filter (where status = 'new'),
        'in_work', count(*) filter (where status in ('assigned', 'in_progress', 'changes_requested')),
        'review', count(*) filter (where status = 'internal_review'),
        'client', count(*) filter (where kind = 'order' and status = 'client_review'),
        'publish', count(*) filter (where kind = 'order' and status in ('approved', 'publishing')),
        'overdue', count(*) filter (where due_date < v_today and public.is_open_task_status(status)),
        'team_open', count(*) filter (where kind = 'team' and public.is_open_task_status(status))
      )
      from public.tasks
    ),
    -- Нагрузка: у кого сколько открытых задач и сколько из них просрочено.
    'workload', (
      select coalesce(jsonb_agg(w order by w.open desc, w.name), '[]'::jsonb)
      from (
        select
          p.id,
          coalesce(nullif(p.full_name, ''), p.email) as name,
          p.role,
          p.job_title,
          p.avatar_path,
          p.accent_color,
          count(t.id) filter (where public.is_open_task_status(t.status)) as open,
          count(t.id) filter (where public.is_open_task_status(t.status) and t.kind = 'team') as team_open,
          count(t.id) filter (where public.is_open_task_status(t.status) and t.due_date < v_today) as overdue
        from public.profiles p
        left join public.tasks t on t.assignee_id = p.id
        where public.is_employee_role(p.role) and p.role <> 'admin'
        group by p.id
      ) w
    ),
    -- Нагрузка AI-агентов: сейчас работают, их версии ждут проверки человеком, сделано за 7 дней.
    'workload_agents', (
      select jsonb_agg(a order by a.running + a.to_review desc, a.ord)
      from (
        select
          ag.id,
          ag.ord,
          (select count(*) from public.agent_runs r where r.agent = ag.id and r.status = 'running') as running,
          (
            select count(*) from public.tasks t
            where t.status = 'internal_review'
              and (select d.agent from public.deliverables d where d.task_id = t.id order by d.version desc limit 1) = ag.id
          ) as to_review,
          (
            select count(*) from public.agent_runs r
            where r.agent = ag.id and r.status in ('done', 'applied') and r.created_at >= now() - interval '7 days'
          ) as done_week,
          (
            select count(*) from public.agent_runs r
            where r.agent = ag.id and r.status = 'failed' and r.created_at >= now() - interval '7 days'
          ) as failed_week
        from unnest(array['smm', 'designer', 'scriptwriter', 'targetologist', 'seo', 'manager'])
          with ordinality as ag(id, ord)
      ) a
    )
  );
end;
$$;
