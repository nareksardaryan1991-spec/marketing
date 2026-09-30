-- Этап 5: расписание и публикация, контент-календарь, продление ежемесячных заказов.

alter table public.tasks
  add column publish_at timestamptz,
  add column published_at timestamptz,
  add column published_url text;

create index tasks_publish_at_idx on public.tasks (publish_at);

-- Кто отвечает за публикацию задачи: клиент (режим 'client') или штатная команда.
create function public.can_publish_task(p_task_id uuid)
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
      and case
        when o.publishing = 'client' then o.client_id = auth.uid() or public.is_team()
        else public.is_team()
      end
  );
$$;

-- Дата публикации. Можно ставить заранее (с момента назначения), менять — пока не опубликовано.
create function public.schedule_task(p_task_id uuid, p_publish_at timestamptz)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.can_publish_task(p_task_id) then
    raise exception 'task not found';
  end if;

  update public.tasks
     set publish_at = p_publish_at,
         -- Перенесли на будущее — снова ждём своего времени.
         status = case
           when status = 'publishing' and (p_publish_at is null or p_publish_at > now())
             then 'approved'::public.task_status
           else status
         end
   where id = p_task_id and status <> 'published';
  if not found then
    raise exception 'task is already published';
  end if;
end;
$$;

create function public.mark_published(p_task_id uuid, p_url text default null)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  if not public.can_publish_task(p_task_id) then
    raise exception 'task not found';
  end if;

  update public.tasks
     set status = 'published',
         published_at = now(),
         published_url = nullif(trim(p_url), '')
   where id = p_task_id and status in ('approved', 'publishing')
  returning order_id into v_order_id;
  if not found then
    raise exception 'task is not approved yet';
  end if;

  -- Всё опубликовано — заказ выполнен.
  update public.orders
     set status = 'completed'
   where id = v_order_id
     and status in ('paid', 'in_progress')
     and not exists (
       select 1 from public.tasks where order_id = v_order_id and status <> 'published'
     );
end;
$$;

revoke execute on function public.schedule_task, public.mark_published from public, anon;
grant execute on function public.schedule_task, public.mark_published to authenticated;

-- Время пришло: одобренные задачи с наступившей датой → 'publishing' (+ уведомление).
-- Запускается по расписанию (pg_cron, ниже).
create function public.process_due_publications()
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.tasks
     set status = 'publishing'
   where status = 'approved' and publish_at is not null and publish_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------- Продление ежемесячных заказов ----------

-- Копия заказа по текущим ценам (для клиента: «Повторить заказ»).
create function public.repeat_order(p_order_id uuid)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id and client_id = auth.uid();
  if not found then
    raise exception 'order not found';
  end if;

  return public.create_order(
    v_order.business_id,
    (select jsonb_agg(jsonb_build_object('service_id', service_id, 'quantity', quantity))
       from public.order_items where order_id = p_order_id),
    v_order.billing,
    v_order.publishing,
    v_order.ad_budget_amd,
    v_order.notes
  );
end;
$$;

revoke execute on function public.repeat_order from public, anon;
grant execute on function public.repeat_order to authenticated;

alter table public.orders add column renewal_notified_at timestamptz;

-- Через 30 дней после оплаты ежемесячного заказа клиенту приходит напоминание (один раз),
-- если он ещё не оформил следующий заказ для этого бизнеса.
create function public.process_renewals()
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  v_order record;
  v_count integer := 0;
begin
  for v_order in
    select o.*, b.name as business_name
    from public.orders o
    join public.businesses b on b.id = o.business_id
    where o.billing = 'monthly'
      and o.paid_at <= now() - interval '30 days'
      and o.renewal_notified_at is null
      and o.status <> 'cancelled'
      and not exists (
        select 1 from public.orders newer
        where newer.business_id = o.business_id
          and newer.billing = 'monthly'
          and newer.created_at > o.paid_at
      )
  loop
    perform public.notify_users(
      array[v_order.client_id],
      'renewal_due',
      jsonb_build_object('order_id', v_order.id, 'business', v_order.business_name)
    );
    update public.orders set renewal_notified_at = now() where id = v_order.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.process_due_publications, public.process_renewals
  from public, anon, authenticated;

-- ---------- Уведомления о публикации ----------

create or replace function public.on_task_changed()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_payload jsonb := public.task_payload(new);
  v_order public.orders;
  v_comment text;
begin
  select * into v_order from public.orders where id = new.order_id;

  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id then
    perform public.notify_users(array[new.assignee_id], 'task_assigned', v_payload);
  end if;

  if new.status is distinct from old.status then
    if new.status = 'internal_review' then
      perform public.notify_users(public.manager_ids(), 'task_review', v_payload);
    elsif new.status = 'in_progress' and old.status = 'internal_review' then
      perform public.notify_users(array[new.assignee_id], 'task_returned', v_payload);
    elsif new.status = 'client_review' then
      perform public.notify_users(array[v_order.client_id], 'client_review', v_payload);
    elsif new.status in ('approved', 'changes_requested') and old.status = 'client_review' then
      select comment into v_comment
      from public.approvals where task_id = new.id order by created_at desc limit 1;
      perform public.notify_users(
        public.manager_ids() || new.assignee_id,
        case when new.status = 'approved' then 'client_approved' else 'client_changes' end,
        v_payload || jsonb_build_object('comment', v_comment)
      );
    elsif new.status = 'publishing' then
      -- Напоминание тому, кто публикует.
      if v_order.publishing = 'client' then
        perform public.notify_users(array[v_order.client_id], 'publish_due', v_payload);
      else
        perform public.notify_users(
          public.manager_ids()
            || coalesce((select array_agg(id) from public.profiles where role = 'smm'), '{}'),
          'publish_due',
          v_payload
        );
      end if;
    elsif new.status = 'published' and v_order.publishing <> 'client' then
      perform public.notify_users(
        array[v_order.client_id],
        'task_published',
        v_payload || jsonb_build_object('url', new.published_url)
      );
    end if;
  end if;
  return new;
end;
$$;

-- ---------- Расписание (pg_cron есть в Supabase; локально его может не быть) ----------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('due-publications', '*/5 * * * *', 'select public.process_due_publications()');
    perform cron.schedule('monthly-renewals', '0 9 * * *', 'select public.process_renewals()');
  end if;
end;
$$;
