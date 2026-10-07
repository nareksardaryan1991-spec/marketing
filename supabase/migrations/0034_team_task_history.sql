-- История задачи команды: кто, что и когда изменил.
--
-- Пишет сама база (триггер на tasks и set_task_watchers), поэтому в историю попадает любое изменение —
-- из приложения, из функций проверки и сдачи, от AI-агента. Одна строка — одно поле:
--   created      — задача поставлена;
--   title, brief, due_date, priority, status, attachments — старое и новое значение как есть;
--   assignee_id, reviewer_id — id людей (имена приложение берёт из профилей команды);
--   business     — название клиента (сотрудник может не видеть сам бизнес);
--   related_order_id — id заказа;
--   watchers     — список id «Кто видит».
-- actor_id пустой — изменение сделал сервер (например, расписание).
-- Видят историю те же, кто видит задачу. Вручную её не пишет и не правит никто.

create table public.task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
create index task_history_task_id_idx on public.task_history (task_id, created_at);
alter table public.task_history enable row level security;

create policy "task_history: read"
  on public.task_history for select
  using (public.can_work_on_task(task_id));

create function public.log_team_task()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_field text;
begin
  if tg_op = 'INSERT' then
    insert into public.task_history (task_id, actor_id, field, new_value)
    values (new.id, auth.uid(), 'created', to_jsonb(new.title));
    return new;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach v_field in array array[
    'title', 'brief', 'due_date', 'priority', 'status', 'assignee_id', 'reviewer_id', 'related_order_id', 'attachments'
  ] loop
    if v_old -> v_field is distinct from v_new -> v_field then
      insert into public.task_history (task_id, actor_id, field, old_value, new_value)
      values (new.id, auth.uid(), v_field, v_old -> v_field, v_new -> v_field);
    end if;
  end loop;
  if old.business_id is distinct from new.business_id then
    insert into public.task_history (task_id, actor_id, field, old_value, new_value)
    values (
      new.id, auth.uid(), 'business',
      to_jsonb((select name from public.businesses where id = old.business_id)),
      to_jsonb((select name from public.businesses where id = new.business_id))
    );
  end if;
  return new;
end;
$$;

create trigger tasks_log_team
  after insert or update on public.tasks
  for each row
  when (new.kind = 'team')
  execute function public.log_team_task();

-- «Кто видит» — тоже в историю. При постановке задачи не пишем: это часть «задача поставлена»
-- (задача создана в этой же транзакции — created_at = now()).
create or replace function public.set_task_watchers(p_task_id uuid, p_watchers uuid[])
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if exists (
    select 1 from unnest(p_watchers) w
    where not exists (select 1 from public.profiles where id = w and public.is_employee_role(role))
  ) then
    raise exception 'watchers must be team members';
  end if;
  select coalesce(jsonb_agg(user_id order by user_id), '[]') into v_old
    from public.task_watchers where task_id = p_task_id;

  delete from public.task_watchers where task_id = p_task_id;
  insert into public.task_watchers (task_id, user_id)
  select distinct p_task_id, w
  from unnest(p_watchers) w
  join public.profiles p on p.id = w
  where p.role <> 'admin';

  select coalesce(jsonb_agg(user_id order by user_id), '[]') into v_new
    from public.task_watchers where task_id = p_task_id;
  if v_old <> v_new and (select created_at from public.tasks where id = p_task_id) < now() then
    insert into public.task_history (task_id, actor_id, field, old_value, new_value)
    values (p_task_id, auth.uid(), 'watchers', v_old, v_new);
  end if;
end;
$$;

revoke execute on function public.log_team_task from public, anon, authenticated;
revoke execute on function public.set_task_watchers from public, anon, authenticated;
