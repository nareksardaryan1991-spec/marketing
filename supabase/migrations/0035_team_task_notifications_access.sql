-- Уведомления о задачах команды — только тем, кто задачу видит.
--   * «Сдано на проверку» — проверяющему (раньше — всем менеджерам).
--   * «Просрочено» — исполнителю, автору, проверяющему, владельцу и отмеченным менеджерам
--     (раньше — всем менеджерам).
--     Менеджеру, который задачу не видит, — одно сообщение в день только с числом, без названий
--     (team_overdue_hidden).
--   * Защитная сетка: уведомление о задаче команды (payload.kind = 'team') человеку, который её не видит,
--     не записывается вообще — откуда бы его ни отправили.

-- Видит ли задачу команды конкретный человек (а не тот, кто сейчас вошёл).
create function public.user_sees_team_task(p_task public.tasks, p_user uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select p_task.kind = 'team' and p_user is not null and (
    p_user in (p_task.created_by, p_task.assignee_id, p_task.reviewer_id)
    or exists (select 1 from public.task_watchers where task_id = p_task.id and user_id = p_user)
    or exists (select 1 from public.profiles where id = p_user and role = 'admin')
  );
$$;

create or replace function public.sees_team_task(p_task public.tasks)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.user_sees_team_task(p_task, auth.uid());
$$;

create function public.skip_hidden_task_notification()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = (new.payload ->> 'task_id')::uuid;
  if not found or not public.user_sees_team_task(v_task, new.user_id) then
    return null;
  end if;
  return new;
end;
$$;

create trigger notifications_team_task_access
  before insert on public.notifications
  for each row
  when (new.payload ->> 'kind' = 'team')
  execute function public.skip_hidden_task_notification();

-- Сдано на проверку: задача команды — проверяющему (нет его — автору, нет и автора — владельцу).
create or replace function public.on_task_changed()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_payload jsonb := public.task_payload(new);
  v_order public.orders;
  v_comment text;
  v_auto boolean;
  v_marks integer;
begin
  select * into v_order from public.orders where id = new.order_id;

  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id then
    perform public.notify_users(array[new.assignee_id], 'task_assigned', v_payload);
  end if;

  if new.status is distinct from old.status then
    if new.status = 'internal_review' then
      perform public.notify_users(
        case
          when new.kind = 'team' and coalesce(new.reviewer_id, new.created_by) is not null
            then array[coalesce(new.reviewer_id, new.created_by)]
          else public.manager_ids()
        end,
        'task_review',
        v_payload
      );
    elsif new.status = 'in_progress' and old.status = 'internal_review' then
      -- Комментарий проверки из этой же транзакции (review_task пишет его до смены статуса).
      select body into v_comment from public.task_comments
       where task_id = new.id and created_at = now()
       order by created_at desc limit 1;
      perform public.notify_users(
        array[new.assignee_id], 'task_returned', v_payload || jsonb_build_object('comment', v_comment)
      );
    elsif new.kind = 'team' and new.status = 'approved' and old.status = 'internal_review' then
      perform public.notify_users(array[new.assignee_id], 'task_done', v_payload);
    elsif new.status = 'client_review' then
      perform public.notify_users(array[v_order.client_id], 'client_review', v_payload);
    elsif new.status in ('approved', 'changes_requested') and old.status = 'client_review' then
      select a.comment, a.auto, (select count(*) from public.approval_marks m where m.approval_id = a.id)
        into v_comment, v_auto, v_marks
      from public.approvals a where a.task_id = new.id order by a.created_at desc limit 1;
      perform public.notify_users(
        public.manager_ids() || new.assignee_id,
        case
          when new.status = 'changes_requested' then 'client_changes'
          when v_auto then 'client_auto_approved'
          else 'client_approved'
        end,
        v_payload || jsonb_build_object('comment', v_comment, 'marks', v_marks)
      );
    elsif new.status = 'publishing' then
      if v_order.publishing = 'client' then
        perform public.notify_users(array[v_order.client_id], 'publish_due', v_payload);
      elsif not (
        v_order.publishing = 'auto'
        and coalesce(new.platform_id, 'instagram') = 'instagram'
        and exists (select 1 from public.social_accounts where business_id = new.business_id)
      ) then
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

-- Напоминания о сроках. Просроченная задача команды — тем, кто её видит; остальным менеджерам —
-- сколько просрочено задач, которых они не видят.
create or replace function public.process_due_reminders()
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  v_today date := public.yerevan_today();
  v_task public.tasks;
  v_payload jsonb;
  v_count integer := 0;
  v_hidden public.tasks[] := '{}';
  v_manager uuid;
  v_n integer;
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
    elsif v_task.kind = 'team' then
      -- Менеджеры и владелец — как у работы по заказу, но защитная сетка оставит только тех, кто видит.
      perform public.notify_users(
        array[v_task.assignee_id, v_task.created_by, v_task.reviewer_id] || public.manager_ids(),
        'task_overdue',
        v_payload
      );
      v_hidden := v_hidden || v_task;
    else
      -- Просрочено: исполнителю и менеджерам (без исполнителя — только менеджерам). Каждый день.
      perform public.notify_users(public.manager_ids() || v_task.assignee_id, 'task_overdue', v_payload);
    end if;
    update public.tasks set due_reminded_on = v_today where id = v_task.id;
    v_count := v_count + 1;
  end loop;

  foreach v_manager in array (select coalesce(array_agg(id), '{}') from public.profiles where role = 'manager') loop
    select count(*) into v_n from unnest(v_hidden) t where not public.user_sees_team_task(t, v_manager);
    if v_n > 0 then
      perform public.notify_users(array[v_manager], 'team_overdue_hidden', jsonb_build_object('count', v_n));
    end if;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.user_sees_team_task, public.skip_hidden_task_notification, public.process_due_reminders
  from public, anon, authenticated;
