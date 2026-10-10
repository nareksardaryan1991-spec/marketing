-- Уведомления по задачам команды внутри сайта.
--
--   * Лента в приложении: у уведомления есть read_at — «прочитано». Отмечает только сам человек
--     (mark_notifications_read), больше ничего в уведомлении он не меняет.
--   * Смена статуса задачи команды (task_status) — исполнителю, автору и проверяющему, кроме того, кто сменил.
--     Не дублирует уже существующие: «сдано на проверку» (task_review — проверяющему), «вернули» (task_returned) и
--     «приняли» (task_done) — исполнителю. Смена статуса из-за назначения исполнителя — это task_assigned, не статус.
--   * Комментарий к задаче команды (task_comment) — исполнителю, автору, проверяющему и отмеченным в «Кто видит»,
--     кроме автора комментария. Комментарий возврата отдельно не приходит — он уже в уведомлении о возврате.
--   * Защитная сетка из 0035 по-прежнему не запишет уведомление тому, кто задачу не видит.

alter table public.notifications add column read_at timestamptz;
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- p_ids пустой — отметить прочитанными все свои.
create function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql
security definer set search_path = ''
as $$
  update public.notifications
     set read_at = now()
   where user_id = auth.uid()
     and read_at is null
     and (p_ids is null or id = any (p_ids));
$$;

-- Имя того, кто сейчас действует (для текста уведомления).
create function public.actor_name()
returns text
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(nullif(trim(full_name), ''), email) from public.profiles where id = auth.uid();
$$;

-- ---------- Смена статуса ----------

create function public.on_team_task_status()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_already uuid[] := '{}';
begin
  -- Назначили исполнителя — ему придёт task_assigned, остальным смена «Бэклог → К выполнению» не нужна.
  if new.assignee_id is distinct from old.assignee_id then
    return new;
  end if;
  -- Кому уже пришло отдельное уведомление (on_task_changed).
  if new.status = 'internal_review' then
    v_already := array[coalesce(new.reviewer_id, new.created_by)];
  elsif old.status = 'internal_review' and new.status in ('in_progress', 'approved') then
    v_already := array[new.assignee_id];
  end if;

  perform public.notify_users(
    array(
      select distinct u
      from unnest(array[new.assignee_id, new.created_by, new.reviewer_id]) u
      where u is not null
        and u is distinct from auth.uid()
        and not (u = any (v_already))
    ),
    'task_status',
    public.task_payload(new) || jsonb_build_object('from', old.status, 'status', new.status, 'actor', public.actor_name())
  );
  return new;
end;
$$;

create trigger tasks_notify_team_status
  after update of status on public.tasks
  for each row
  when (new.kind = 'team' and new.status is distinct from old.status)
  execute function public.on_team_task_status();

-- ---------- Комментарии ----------

create function public.on_team_task_comment()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_task public.tasks;
  v_body text := trim(new.body);
begin
  -- Комментарий проверки (review_task) — часть уведомления о возврате.
  if current_setting('app.review_comment', true) = 'on' then
    return new;
  end if;
  select * into v_task from public.tasks where id = new.task_id;
  if not found or v_task.kind <> 'team' then
    return new;
  end if;
  perform public.notify_users(
    array(
      select distinct u
      from unnest(
        array[v_task.assignee_id, v_task.created_by, v_task.reviewer_id]
          || coalesce((select array_agg(user_id) from public.task_watchers where task_id = v_task.id), '{}')
      ) u
      where u is not null and u <> new.author_id
    ),
    'task_comment',
    public.task_payload(v_task) || jsonb_build_object(
      'author', (select coalesce(nullif(trim(full_name), ''), email) from public.profiles where id = new.author_id),
      'preview', case when length(v_body) > 140 then left(v_body, 140) || '…' else v_body end
    )
  );
  return new;
end;
$$;

create trigger task_comments_notify_team
  after insert on public.task_comments
  for each row execute function public.on_team_task_comment();

-- review_task из 0033 — отмечает комментарий возврата, чтобы он не пришёл отдельным уведомлением.
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
    -- Комментарий возврата уже есть в уведомлении task_returned; комментарий при приёмке приходит как обычный.
    perform set_config('app.review_comment', case when p_approve then '' else 'on' end, true);
    insert into public.task_comments (task_id, author_id, body)
    values (p_task_id, auth.uid(), trim(p_comment));
    perform set_config('app.review_comment', '', true);
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

revoke execute on function public.on_team_task_status, public.on_team_task_comment, public.actor_name
  from public, anon, authenticated;
revoke execute on function public.mark_notifications_read from public, anon;
grant execute on function public.mark_notifications_read to authenticated;
