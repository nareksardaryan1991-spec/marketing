-- Этап 3: работа команды и панель владельца.
-- 1. Напоминания о сроках задач (исполнителю; о просроченных — и менеджерам).
-- 2. Цифры для панели владельца и менеджеров (деньги — только владельцу).
-- 3. Утренняя сводка владельцу в Telegram / push.
-- Дни считаются по времени Еревана; расписание — 09:00 по Еревану (05:00 UTC).

create function public.yerevan_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Yerevan')::date;
$$;

-- Начало дня по Еревану как момент времени.
create function public.yerevan_day_start(p_day date)
returns timestamptz
language sql
immutable
as $$
  select p_day::timestamp at time zone 'Asia/Yerevan';
$$;

-- Работа ещё за командой: не у клиента на согласовании и не готова к публикации.
create function public.is_open_task_status(p_status public.task_status)
returns boolean
language sql
immutable
as $$
  select p_status in ('new', 'assigned', 'in_progress', 'internal_review', 'changes_requested');
$$;

-- ---------- Напоминания о сроках ----------

alter table public.tasks add column due_reminded_on date;

create function public.process_due_reminders()
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  v_today date := public.yerevan_today();
  v_task public.tasks;
  v_payload jsonb;
  v_count integer := 0;
begin
  for v_task in
    select * from public.tasks
    where due_date is not null
      and due_date <= v_today + 1
      and public.is_open_task_status(status)
      and due_reminded_on is distinct from v_today
    for update
  loop
    v_payload := public.task_payload(v_task) || jsonb_build_object('due_date', v_task.due_date);
    if v_task.due_date = v_today + 1 then
      perform public.notify_users(array[v_task.assignee_id], 'task_due_soon', v_payload);
    elsif v_task.due_date = v_today then
      perform public.notify_users(array[v_task.assignee_id], 'task_due_today', v_payload);
    else
      -- Просрочено: исполнителю и менеджерам (без исполнителя — только менеджерам). Каждый день.
      perform public.notify_users(public.manager_ids() || v_task.assignee_id, 'task_overdue', v_payload);
    end if;
    update public.tasks set due_reminded_on = v_today where id = v_task.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------- Панель владельца ----------

create function public.owner_dashboard()
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
    'tasks', (
      select jsonb_build_object(
        'unassigned', count(*) filter (where status = 'new'),
        'in_work', count(*) filter (where status in ('assigned', 'in_progress', 'changes_requested')),
        'review', count(*) filter (where status = 'internal_review'),
        'client', count(*) filter (where status = 'client_review'),
        'publish', count(*) filter (where status in ('approved', 'publishing')),
        'overdue', count(*) filter (where due_date < v_today and public.is_open_task_status(status))
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
          p.avatar_path,
          p.accent_color,
          count(t.id) filter (where public.is_open_task_status(t.status)) as open,
          count(t.id) filter (where public.is_open_task_status(t.status) and t.due_date < v_today) as overdue
        from public.profiles p
        left join public.tasks t on t.assignee_id = p.id
        where public.is_employee_role(p.role) and p.role <> 'admin'
        group by p.id
      ) w
    )
  );
end;
$$;

-- ---------- Утренняя сводка владельцу ----------

create function public.process_daily_digest()
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  v_today date := public.yerevan_today();
  v_from timestamptz := public.yerevan_day_start(v_today - 1);
  v_to timestamptz := public.yerevan_day_start(v_today);
  v_admins uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_admins from public.profiles where role = 'admin';
  if cardinality(v_admins) = 0 then
    return 0;
  end if;
  perform public.notify_users(
    v_admins,
    'daily_digest',
    jsonb_build_object(
      'new_orders', (select count(*) from public.orders where created_at >= v_from and created_at < v_to),
      'revenue', (
        select coalesce(sum(amount_amd), 0) from public.payments
        where status = 'succeeded' and updated_at >= v_from and updated_at < v_to
      ),
      'submitted', (select count(*) from public.deliverables where created_at >= v_from and created_at < v_to),
      'published', (select count(*) from public.tasks where published_at >= v_from and published_at < v_to),
      'to_review', (select count(*) from public.tasks where status = 'internal_review'),
      'unassigned', (select count(*) from public.tasks where status = 'new'),
      'overdue', (
        select count(*) from public.tasks where due_date < v_today and public.is_open_task_status(status)
      )
    )
  );
  return cardinality(v_admins);
end;
$$;

revoke execute on function public.process_due_reminders, public.process_daily_digest
  from public, anon, authenticated;
revoke execute on function public.owner_dashboard from public, anon;
grant execute on function public.owner_dashboard to authenticated;

-- ---------- Расписание: каждый день в 09:00 по Еревану ----------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('due-reminders', '0 5 * * *', 'select public.process_due_reminders()');
    perform cron.schedule('daily-digest', '0 5 * * *', 'select public.process_daily_digest()');
  end if;
end;
$$;
