-- Уведомления по задачам команды.
--   * сотруднику — сразу при создании задачи с исполнителем (раньше — только при смене исполнителя);
--   * сотруднику — за день до срока и в день срока (process_due_reminders, как у работы по заказу);
--   * менеджерам — когда работу сдали на проверку (task_review, как у работы по заказу);
--   * сотруднику — когда вернули (с комментарием менеджера) или приняли (task_done).
-- Текст собирает notify-dispatch: у задачи команды вместо услуги и номера — название и важность.

create or replace function public.task_payload(p_task public.tasks)
returns jsonb
language sql
stable
security definer set search_path = ''
as $$
  select jsonb_build_object(
    'task_id', p_task.id,
    'order_id', p_task.order_id,
    'service_id', p_task.service_id,
    'platform', (select name from public.platforms where id = p_task.platform_id),
    'number', p_task.number,
    'business', (select name from public.businesses where id = p_task.business_id),
    'kind', p_task.kind,
    'title', p_task.title,
    'priority', p_task.priority
  );
$$;

-- Задача команды создаётся сразу с исполнителем — ему уведомление о назначении.
create function public.on_task_created()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  perform public.notify_users(array[new.assignee_id], 'task_assigned', public.task_payload(new));
  return new;
end;
$$;

create trigger tasks_notify_created
  after insert on public.tasks
  for each row
  when (new.kind = 'team' and new.assignee_id is not null)
  execute function public.on_task_created();

-- Комментарий проверки пишется до смены статуса — чтобы уведомление о возврате пришло вместе с ним.
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

  select kind into v_kind from public.tasks where id = p_task_id and status = 'internal_review' for update;
  if not found then
    raise exception 'task is not waiting for review';
  end if;
  if v_kind = 'team' and not p_approve and nullif(trim(p_comment), '') is null then
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
       set sent_to_client_at = case when v_kind = 'order' then now() else sent_to_client_at end,
           reviewed_by = auth.uid(),
           reviewer_name = (select coalesce(nullif(trim(full_name), ''), email) from public.profiles where id = auth.uid())
     where id = (
       select id from public.deliverables where task_id = p_task_id order by version desc limit 1
     );
  end if;
end;
$$;

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
      perform public.notify_users(public.manager_ids(), 'task_review', v_payload);
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

revoke execute on function public.on_task_created from public, anon, authenticated;
