-- Автопубликация в Instagram (Instagram API with Instagram Login).

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  platform text not null default 'instagram' check (platform in ('instagram')),
  external_user_id text not null,
  username text,
  -- Токен читает только сервер (service role), см. права на колонки ниже.
  access_token text not null,
  token_expires_at timestamptz not null,
  connected_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, platform)
);

create trigger social_accounts_set_updated_at
  before update on public.social_accounts
  for each row execute function public.set_updated_at();

alter table public.social_accounts enable row level security;

create policy "social_accounts: read own or team"
  on public.social_accounts for select
  using (
    public.is_team()
    or exists (select 1 from public.businesses b where b.id = business_id and b.owner_id = auth.uid())
  );

revoke all on public.social_accounts from anon, authenticated;
grant select (id, business_id, platform, username, token_expires_at, created_at)
  on public.social_accounts to authenticated;

-- Отключить аккаунт может владелец бизнеса или менеджер.
create function public.disconnect_social_account(p_business_id uuid, p_platform text default 'instagram')
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not (
    public.is_manager()
    or exists (select 1 from public.businesses where id = p_business_id and owner_id = auth.uid())
  ) then
    raise exception 'business not found';
  end if;
  delete from public.social_accounts where business_id = p_business_id and platform = p_platform;
end;
$$;

revoke execute on function public.disconnect_social_account from public, anon;
grant execute on function public.disconnect_social_account to authenticated;

-- Одноразовые state для OAuth (защита от подмены). Пишет и читает только сервер.
create table public.oauth_states (
  state text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  return_url text not null,
  created_at timestamptz not null default now()
);

alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;

-- ---------- Состояние автопубликации задачи ----------

alter table public.tasks
  add column autopublish_state jsonb not null default '{}'::jsonb,
  add column publish_error text;

-- Успех автопубликации (вызывает только Edge Function auto-publish).
create function public.mark_auto_published(p_task_id uuid, p_media_id text, p_url text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  update public.tasks
     set status = 'published',
         published_at = now(),
         published_url = p_url,
         publish_error = null,
         autopublish_state = autopublish_state || jsonb_build_object('media_id', p_media_id)
   where id = p_task_id and status = 'publishing'
  returning order_id into v_order_id;
  if not found then
    return;
  end if;

  update public.orders
     set status = 'completed'
   where id = v_order_id
     and status in ('paid', 'in_progress')
     and not exists (
       select 1 from public.tasks where order_id = v_order_id and status <> 'published'
     );
end;
$$;

-- Ошибка: задача остаётся «Пора публиковать», менеджеры получают уведомление с причиной.
create function public.mark_auto_publish_failed(p_task_id uuid, p_error text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  update public.tasks
     set publish_error = left(p_error, 1000),
         autopublish_state = autopublish_state || jsonb_build_object('failed', true)
   where id = p_task_id and status = 'publishing'
  returning * into v_task;
  if not found then
    return;
  end if;

  perform public.notify_users(
    public.manager_ids(),
    'publish_failed',
    public.task_payload(v_task) || jsonb_build_object('error', left(p_error, 300))
  );
end;
$$;

revoke execute on function public.mark_auto_published, public.mark_auto_publish_failed
  from public, anon, authenticated;
grant execute on function public.mark_auto_published, public.mark_auto_publish_failed
  to service_role;

-- При переносе даты или ручной публикации сбрасываем попытку автопубликации.
create or replace function public.schedule_task(p_task_id uuid, p_publish_at timestamptz)
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
         publish_error = null,
         autopublish_state = '{}'::jsonb,
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

-- В режиме «автоматически» с подключённым Instagram напоминание «пора публиковать»
-- не нужно — публикует сервер. Без подключённого аккаунта напоминание приходит как раньше.
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
      if v_order.publishing = 'client' then
        perform public.notify_users(array[v_order.client_id], 'publish_due', v_payload);
      elsif not (
        v_order.publishing = 'auto'
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
