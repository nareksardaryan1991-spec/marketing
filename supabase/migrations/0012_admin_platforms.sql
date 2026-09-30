-- 1. Владелец (admin) — единственный, кто назначает роли.
-- 2. Регистрация сотрудника: роль 'pending', пока владелец не назначит роль.
-- 3. Площадки (Instagram, Facebook, TikTok): у каждой свои услуги и цены;
--    заказ и задачи — по площадкам.

-- ---------- Роли ----------

-- Сотрудник агентства (включая фрилансера и владельца), а не клиент и не ожидающий.
create function public.is_employee_role(p_role public.user_role)
returns boolean
language sql
immutable
as $$
  select p_role not in ('client', 'pending');
$$;

-- Штатная команда: сотрудники без фрилансеров.
create function public.is_team_role(p_role public.user_role)
returns boolean
language sql
immutable
as $$
  select p_role not in ('client', 'pending', 'freelancer');
$$;

create or replace function public.is_team()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(public.is_team_role(public.my_role()), false);
$$;

-- Владелец управляет работой так же, как менеджер.
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(public.my_role() in ('manager', 'admin'), false);
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(public.my_role() = 'admin', false);
$$;

create or replace function public.manager_ids()
returns uuid[]
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(array_agg(id), '{}') from public.profiles where role in ('manager', 'admin');
$$;

-- Роли назначает только владелец. Владелец один: роль admin назначается только
-- напрямую в базе (scripts/make-admin.sh), свою роль менять нельзя.
create or replace function public.set_user_role(target_user uuid, new_role public.user_role)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'only the administrator can change roles';
  end if;
  if target_user = auth.uid() then
    raise exception 'you cannot change your own role';
  end if;
  if new_role = 'admin' then
    raise exception 'there is only one administrator';
  end if;
  update public.profiles set role = new_role where id = target_user and role <> 'admin';
  if not found then
    raise exception 'user not found';
  end if;
end;
$$;

-- Регистрация: "Я сотрудник" → pending (+ уведомление владельцу), иначе клиент.
-- Выбрать себе другую роль при регистрации нельзя.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_staff boolean := new.raw_user_meta_data ->> 'account_type' = 'staff';
begin
  insert into public.profiles (id, full_name, language, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'language', ''), 'ru'),
    new.email,
    case when v_staff then 'pending' else 'client' end::public.user_role
  );
  if v_staff then
    perform public.notify_users(
      (select coalesce(array_agg(id), '{}') from public.profiles where role = 'admin'),
      'staff_signup',
      jsonb_build_object('name', coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'email', new.email)
    );
  end if;
  return new;
end;
$$;

-- Сотрудники видят профили коллег; ожидающие — нет.
drop policy "profiles: staff see staff" on public.profiles;
create policy "profiles: staff see staff"
  on public.profiles for select
  using (public.is_employee_role(role) and coalesce(public.is_employee_role(public.my_role()), false));

create or replace function public.assign_task(
  p_task_id uuid,
  p_assignee_id uuid,
  p_due_date date default null,
  p_brief text default null
)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'only managers can assign tasks';
  end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.profiles where id = p_assignee_id and public.is_employee_role(role)
  ) then
    raise exception 'assignee must be a team member';
  end if;

  update public.tasks
     set assignee_id = p_assignee_id,
         due_date = p_due_date,
         brief = nullif(trim(p_brief), ''),
         status = case
           when status = 'new' and p_assignee_id is not null then 'assigned'::public.task_status
           when status = 'assigned' and p_assignee_id is null then 'new'::public.task_status
           else status
         end
   where id = p_task_id;
  if not found then
    raise exception 'task not found';
  end if;
end;
$$;

create or replace function public.open_direct_conversation(p_user_id uuid)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_key text;
  v_id uuid;
begin
  if not coalesce(public.is_employee_role(public.my_role()), false) then
    raise exception 'team chat is for the team only';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot chat with yourself';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and public.is_employee_role(role)) then
    raise exception 'colleague not found';
  end if;

  v_key := least(auth.uid()::text, p_user_id::text) || ':' || greatest(auth.uid()::text, p_user_id::text);
  insert into public.conversations (kind, direct_key) values ('direct', v_key)
  on conflict (direct_key) do nothing;
  select id into v_id from public.conversations where direct_key = v_key;
  insert into public.conversation_members (conversation_id, user_id)
  values (v_id, auth.uid()), (v_id, p_user_id)
  on conflict do nothing;
  return v_id;
end;
$$;

create or replace function public.on_team_message_created()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_kind public.conversation_kind;
  v_recipients uuid[];
begin
  update public.conversations set last_message_at = new.created_at
  where id = new.conversation_id
  returning kind into v_kind;

  if v_kind = 'team' then
    select coalesce(array_agg(id), '{}') into v_recipients
    from public.profiles
    where public.is_team_role(role) and id <> new.author_id;
  else
    select coalesce(array_agg(user_id), '{}') into v_recipients
    from public.conversation_members
    where conversation_id = new.conversation_id and user_id <> new.author_id;
  end if;

  perform public.notify_users(
    v_recipients,
    'team_chat_message',
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      'channel', v_kind,
      'author', new.author_name,
      'preview', left(new.body, 200)
    )
  );
  return new;
end;
$$;

-- ---------- Площадки ----------

create table public.platforms (
  id text primary key,
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true
);

insert into public.platforms (id, name, sort_order) values
  ('instagram', 'Instagram', 10),
  ('facebook', 'Facebook', 20),
  ('tiktok', 'TikTok', 30);

-- Посты, истории и рилсы заказываются для конкретной площадки; реклама и выезд — общие.
alter table public.services add column per_platform boolean not null default false;
update public.services set per_platform = true where id in ('post', 'reel', 'story');

-- Что можно заказать на площадке и по какой цене. label — своё название на площадке
-- (например, рилс в TikTok называется «Видео»).
create table public.platform_services (
  platform_id text not null references public.platforms (id) on delete cascade,
  service_id text not null references public.services (id) on delete cascade,
  price_amd integer not null check (price_amd >= 0),
  label jsonb,
  active boolean not null default true,
  primary key (platform_id, service_id)
);

-- ВРЕМЕННЫЕ цены — владелец или менеджер меняет их на экране «Услуги и цены».
insert into public.platform_services (platform_id, service_id, price_amd, label) values
  ('instagram', 'post', 8000, null),
  ('instagram', 'story', 4000, null),
  ('instagram', 'reel', 25000, null),
  ('facebook', 'post', 6000, null),
  ('facebook', 'story', 3000, null),
  ('facebook', 'reel', 20000, null),
  ('tiktok', 'reel', 25000, '{"ru": "Видео", "hy": "Տեսանյութ", "en": "Video"}');

alter table public.platforms enable row level security;
alter table public.platform_services enable row level security;

create policy "platforms: read" on public.platforms for select to authenticated using (true);
create policy "platforms: manager writes" on public.platforms for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy "platform_services: read" on public.platform_services for select to authenticated using (true);
create policy "platform_services: manager writes" on public.platform_services for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- ---------- Заказы и задачи по площадкам ----------

alter table public.order_items add column platform_id text references public.platforms (id);
alter table public.order_items drop constraint order_items_order_id_service_id_key;
create unique index order_items_unique_line
  on public.order_items (order_id, service_id, platform_id) nulls not distinct;

-- Старые заказы были для Instagram.
update public.order_items i set platform_id = 'instagram'
from public.services s where s.id = i.service_id and s.per_platform and i.platform_id is null;

alter table public.tasks add column platform_id text references public.platforms (id);
alter table public.tasks drop constraint tasks_order_id_service_id_number_key;
update public.tasks t set platform_id = 'instagram'
from public.services s where s.id = t.service_id and s.per_platform and t.platform_id is null;
create unique index tasks_unique_number
  on public.tasks (order_id, service_id, platform_id, number) nulls not distinct;

-- p_items: [{"service_id": "post", "platform_id": "instagram", "quantity": 10}, {"service_id": "video_shoot", "quantity": 1}]
create or replace function public.create_order(
  p_business_id uuid,
  p_items jsonb,
  p_billing public.billing_type,
  p_publishing public.publishing_mode,
  p_ad_budget_amd integer default 0,
  p_notes text default null
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_order_id uuid;
  v_items_total integer;
  v_requested integer;
  v_priced integer;
begin
  if not exists (
    select 1 from public.businesses where id = p_business_id and owner_id = auth.uid()
  ) then
    raise exception 'business not found';
  end if;
  if coalesce(p_ad_budget_amd, 0) < 0 then
    raise exception 'ad budget must be positive';
  end if;

  create temporary table requested_items on commit drop as
    select
      (item ->> 'service_id') as service_id,
      nullif(item ->> 'platform_id', '') as platform_id,
      (item ->> 'quantity')::integer as quantity
    from jsonb_array_elements(p_items) as item;

  delete from requested_items where quantity is null or quantity <= 0;

  if exists (select 1 from requested_items where quantity > 100) then
    raise exception 'quantity too large';
  end if;
  if exists (
    select 1 from requested_items group by service_id, platform_id having count(*) > 1
  ) then
    raise exception 'duplicate service';
  end if;

  -- Цена: для услуги площадки — из platform_services, для общей — из services.
  create temporary table priced_items on commit drop as
    select r.service_id, r.platform_id, r.quantity, coalesce(ps.price_amd, s.price_amd) as price
    from requested_items r
    join public.services s on s.id = r.service_id and s.active
    left join public.platform_services ps
      on ps.platform_id = r.platform_id and ps.service_id = r.service_id and ps.active
    left join public.platforms p on p.id = r.platform_id and p.active
    where (s.per_platform and ps.service_id is not null and p.id is not null)
       or (not s.per_platform and r.platform_id is null);

  select count(*) into v_requested from requested_items;
  select count(*), coalesce(sum(quantity * price), 0) into v_priced, v_items_total from priced_items;

  if v_requested <> v_priced then
    raise exception 'unknown service';
  end if;
  if v_priced = 0 then
    raise exception 'order is empty';
  end if;

  insert into public.orders (
    business_id, client_id, billing, publishing, items_total_amd, ad_budget_amd, total_amd, notes
  ) values (
    p_business_id, auth.uid(), p_billing, p_publishing, v_items_total, coalesce(p_ad_budget_amd, 0),
    v_items_total + coalesce(p_ad_budget_amd, 0), nullif(trim(p_notes), '')
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, service_id, platform_id, quantity, unit_price_amd, line_total_amd)
  select v_order_id, service_id, platform_id, quantity, price, quantity * price
  from priced_items;

  return v_order_id;
end;
$$;

create or replace function public.mark_payment_succeeded(
  p_payment_id uuid,
  p_provider_payment_id text,
  p_raw jsonb
)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_payment public.payments;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment not found';
  end if;
  if v_payment.status = 'succeeded' then
    return;
  end if;

  update public.payments
     set status = 'succeeded',
         provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
         raw = p_raw
   where id = p_payment_id;

  update public.orders
     set status = 'paid', paid_at = now()
   where id = v_payment.order_id and status = 'pending_payment';

  -- Задачи создаются один раз, даже если по заказу пришло две оплаты.
  insert into public.tasks (order_id, business_id, service_id, platform_id, number)
  select o.id, o.business_id, i.service_id, i.platform_id, n
  from public.orders o
  join public.order_items i on i.order_id = o.id
  cross join lateral generate_series(1, i.quantity) as n
  where o.id = v_payment.order_id
    and not exists (select 1 from public.tasks t where t.order_id = o.id);
end;
$$;

create or replace function public.repeat_order(p_order_id uuid)
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
    (select jsonb_agg(jsonb_build_object('service_id', service_id, 'platform_id', platform_id, 'quantity', quantity))
       from public.order_items where order_id = p_order_id),
    v_order.billing,
    v_order.publishing,
    v_order.ad_budget_amd,
    v_order.notes
  );
end;
$$;

-- Уведомления о задаче называют площадку: «Instagram · Пост #2».
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
    'business', (select name from public.businesses where id = p_task.business_id)
  );
$$;

-- Автопубликация — только для Instagram. Для остальных площадок в режиме
-- «Автоматически» напоминание приходит команде, как в режиме «Наша команда».
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
