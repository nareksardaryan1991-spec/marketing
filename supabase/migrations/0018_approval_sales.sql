-- Согласование как у Planable / 99 Dollar Social и продажи как у SPP.co:
-- «одобрить всё сразу», срок ответа клиента и автоодобрение, правки точками на материале,
-- промокоды, номера квитанций.

-- ---------- Настройки агентства (одна строка) ----------

create table public.agency_settings (
  id boolean primary key default true check (id),
  -- Через сколько дней молчания клиента материал одобряется сам. 0 — никогда.
  auto_approve_days integer not null default 3 check (auto_approve_days between 0 and 60),
  updated_at timestamptz not null default now()
);

insert into public.agency_settings default values;

create trigger agency_settings_set_updated_at
  before update on public.agency_settings
  for each row execute function public.set_updated_at();

alter table public.agency_settings enable row level security;

create policy "agency_settings: read"
  on public.agency_settings for select to authenticated using (true);

create policy "agency_settings: admin updates"
  on public.agency_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Срок ответа клиента ----------

alter table public.tasks
  add column client_review_since timestamptz,
  add column review_reminded_on date;

-- Материалы, которые уже ждут клиента, считаются отправленными сейчас:
-- иначе после выкладки они одобрились бы все разом.
update public.tasks set client_review_since = now() where status = 'client_review';

create function public.track_client_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'client_review' and old.status is distinct from 'client_review' then
    new.client_review_since := now();
    new.review_reminded_on := null;
  elsif new.status <> 'client_review' then
    new.client_review_since := null;
  end if;
  return new;
end;
$$;

create trigger tasks_track_client_review
  before update of status on public.tasks
  for each row execute function public.track_client_review();

-- День, когда материал одобрится сам (по Еревану), или null, если автоодобрение выключено.
create function public.auto_approve_on(p_since timestamptz)
returns date
language sql
stable
security definer set search_path = ''
as $$
  select ((p_since at time zone 'Asia/Yerevan')::date + s.auto_approve_days)
  from public.agency_settings s
  where p_since is not null and s.auto_approve_days > 0;
$$;

-- ---------- Решение клиента ----------

alter table public.approvals add column auto boolean not null default false;

-- Точка на материале: где и что поменять. x, y — доля ширины и высоты (0..1),
-- at_seconds — секунда видео.
create table public.approval_marks (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.approvals (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  -- Номер точки, как его видел клиент (1, 2, …).
  position integer not null check (position > 0),
  file_path text not null,
  x real not null check (x between 0 and 1),
  y real not null check (y between 0 and 1),
  at_seconds real check (at_seconds >= 0),
  note text not null check (length(note) between 1 and 500),
  created_at timestamptz not null default now()
);

create index approval_marks_approval_id_idx on public.approval_marks (approval_id);
create index approval_marks_task_id_idx on public.approval_marks (task_id);

alter table public.approval_marks enable row level security;

create policy "approval_marks: read"
  on public.approval_marks for select
  using (public.can_view_task(task_id));

-- Общая часть всех решений клиента: запись в approvals, точки правок и смена статуса задачи.
-- Задача должна быть уже заблокирована и проверена вызывающим (точки — тоже).
create function public.apply_client_decision(
  p_task public.tasks,
  p_approve boolean,
  p_comment text,
  p_auto boolean,
  p_marks jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_approval_id uuid;
begin
  insert into public.approvals (task_id, deliverable_id, decision, comment, decided_by, auto)
  select
    p_task.id,
    d.id,
    case when p_approve then 'approved' else 'changes_requested' end::public.approval_decision,
    nullif(trim(p_comment), ''),
    o.client_id,
    p_auto
  from public.orders o
  cross join lateral (
    select id from public.deliverables where task_id = p_task.id order by version desc limit 1
  ) d
  where o.id = p_task.order_id
  returning id into v_approval_id;

  -- До смены статуса: уведомление команде считает точки.
  insert into public.approval_marks (approval_id, task_id, position, file_path, x, y, at_seconds, note)
  select v_approval_id, p_task.id, e.position, e.m ->> 'file_path', (e.m ->> 'x')::real,
         (e.m ->> 'y')::real, (e.m ->> 'at_seconds')::real, trim(e.m ->> 'note')
  from jsonb_array_elements(p_marks) with ordinality as e(m, position);

  update public.tasks
     set status = case when p_approve then 'approved' else 'changes_requested' end::public.task_status
   where id = p_task.id;

  return v_approval_id;
end;
$$;

revoke execute on function public.apply_client_decision from public, anon, authenticated;

drop function public.client_decide(uuid, boolean, text);

-- Клиент одобряет последнюю версию или просит правки: комментарием и/или точками.
-- p_marks: [{"file_path": "...", "x": 0.4, "y": 0.2, "at_seconds": 3.5, "note": "..."}]
create function public.client_decide(
  p_task_id uuid,
  p_approve boolean,
  p_comment text default null,
  p_marks jsonb default null
)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_task public.tasks;
  v_files text[];
  v_marks jsonb := case when p_approve then '[]'::jsonb else coalesce(p_marks, '[]'::jsonb) end;
begin
  select t.* into v_task
  from public.tasks t
  join public.orders o on o.id = t.order_id
  where t.id = p_task_id and o.client_id = auth.uid()
  for update of t;
  if not found then
    raise exception 'task not found';
  end if;
  if v_task.status <> 'client_review' then
    raise exception 'task is not waiting for your decision';
  end if;
  if jsonb_typeof(v_marks) <> 'array' or jsonb_array_length(v_marks) > 30 then
    raise exception 'invalid marks';
  end if;
  if not p_approve and nullif(trim(p_comment), '') is null and jsonb_array_length(v_marks) = 0 then
    raise exception 'describe what to change';
  end if;

  select files into v_files
  from public.deliverables where task_id = p_task_id order by version desc limit 1;
  if exists (
    select 1 from jsonb_array_elements(v_marks) m
    where not (m ->> 'file_path' = any (coalesce(v_files, '{}')))
       or nullif(trim(m ->> 'note'), '') is null
  ) then
    raise exception 'invalid marks';
  end if;

  perform public.apply_client_decision(v_task, p_approve, p_comment, false, v_marks);
end;
$$;

revoke execute on function public.client_decide from public, anon;
grant execute on function public.client_decide to authenticated;

-- «Одобрить всё»: одобряет перечисленные задачи клиента, которые ждут его решения.
-- Возвращает, сколько одобрено.
create function public.client_approve_many(p_task_ids uuid[])
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  v_task public.tasks;
  v_count integer := 0;
begin
  for v_task in
    select t.* from public.tasks t
    join public.orders o on o.id = t.order_id
    where t.id = any (p_task_ids) and o.client_id = auth.uid() and t.status = 'client_review'
    order by t.id
    for update of t
  loop
    perform public.apply_client_decision(v_task, true, null, false);
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    raise exception 'nothing to approve';
  end if;
  return v_count;
end;
$$;

revoke execute on function public.client_approve_many from public, anon;
grant execute on function public.client_approve_many to authenticated;

-- Уведомление команде: «одобрено автоматически» отдельно от «клиент одобрил».
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
      perform public.notify_users(array[new.assignee_id], 'task_returned', v_payload);
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


-- ---------- Автоодобрение и напоминания клиенту (каждый день в 09:00) ----------

-- Сначала одобряет то, у чего вышел срок. Потом напоминает клиенту одним сообщением
-- обо всём, что ждёт его решения: на следующий день после отправки и за день до срока.
create function public.process_review_deadlines()
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  v_today date := public.yerevan_today();
  v_task public.tasks;
  v_client record;
  v_count integer := 0;
begin
  if (select auto_approve_days from public.agency_settings) = 0 then
    return 0;
  end if;

  for v_task in
    select * from public.tasks
    where status = 'client_review' and public.auto_approve_on(client_review_since) <= v_today
    order by id
    for update
  loop
    perform public.apply_client_decision(v_task, true, null, true);
    v_count := v_count + 1;
  end loop;

  for v_client in
    with pending as (
      select t.id, o.client_id, public.auto_approve_on(t.client_review_since) as deadline,
             t.review_reminded_on is distinct from v_today and (
               (t.client_review_since at time zone 'Asia/Yerevan')::date + 1 = v_today
               or public.auto_approve_on(t.client_review_since) - 1 = v_today
             ) as due
      from public.tasks t
      join public.orders o on o.id = t.order_id
      where t.status = 'client_review'
    )
    select client_id, count(*) as n, min(deadline) as deadline, array_agg(id) as ids
    from pending
    group by client_id
    having bool_or(due)
  loop
    perform public.notify_users(
      array[v_client.client_id],
      'client_review_reminder',
      jsonb_build_object('count', v_client.n, 'deadline', to_char(v_client.deadline, 'DD.MM'))
    );
    update public.tasks set review_reminded_on = v_today where id = any (v_client.ids);
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.process_review_deadlines from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('review-deadlines', '0 5 * * *', 'select public.process_review_deadlines()');
  end if;
end;
$$;

-- ---------- Промокоды ----------

create table public.promo_codes (
  code text primary key check (code ~ '^[A-Z0-9_-]{3,32}$'),
  percent integer check (percent between 1 and 99),
  amount_amd integer check (amount_amd > 0),
  max_uses integer check (max_uses > 0),
  used_count integer not null default 0,
  valid_until date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((percent is null) <> (amount_amd is null))
);

alter table public.promo_codes enable row level security;

-- Список кодов видит только владелец; клиент проверяет код через check_promo.
create policy "promo_codes: admin"
  on public.promo_codes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.orders
  add column promo_code text references public.promo_codes (code) on delete set null,
  add column discount_amd integer not null default 0 check (discount_amd >= 0);

-- Действующий код или ошибка с понятной причиной.
create function public.valid_promo(p_code text)
returns public.promo_codes
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  v_promo public.promo_codes;
begin
  select * into v_promo from public.promo_codes where code = upper(trim(p_code)) and active;
  if not found then
    raise exception 'promo code not found';
  end if;
  if v_promo.valid_until < public.yerevan_today() then
    raise exception 'promo code expired';
  end if;
  if v_promo.used_count >= v_promo.max_uses then
    raise exception 'promo code used up';
  end if;
  return v_promo;
end;
$$;

revoke execute on function public.valid_promo from public, anon, authenticated;

-- Для экрана заказа: какую скидку даёт код (до оплаты, без раскрытия остальных кодов).
create function public.check_promo(p_code text)
returns jsonb
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  v_promo public.promo_codes := public.valid_promo(p_code);
begin
  return jsonb_build_object('code', v_promo.code, 'percent', v_promo.percent, 'amount_amd', v_promo.amount_amd);
end;
$$;

revoke execute on function public.check_promo from public, anon;
grant execute on function public.check_promo to authenticated;

-- Скидка на сумму услуг (рекламный бюджет не уменьшается).
create function public.promo_discount(p_promo public.promo_codes, p_items_total integer)
returns integer
language sql
immutable
as $$
  select least(
    p_items_total,
    coalesce(p_promo.amount_amd, (p_items_total * p_promo.percent / 100.0)::integer)
  );
$$;

drop function public.create_order(uuid, jsonb, public.billing_type, public.publishing_mode, integer, text);

-- Как раньше, плюс промокод: скидка считается здесь, на сервере.
-- Повтор заказа и продления идут без кода, по полной цене.
create function public.create_order(
  p_business_id uuid,
  p_items jsonb,
  p_billing public.billing_type,
  p_publishing public.publishing_mode,
  p_ad_budget_amd integer default 0,
  p_notes text default null,
  p_promo_code text default null
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
  v_promo public.promo_codes;
  v_discount integer := 0;
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

  if nullif(trim(p_promo_code), '') is not null then
    v_promo := public.valid_promo(p_promo_code);
    v_discount := public.promo_discount(v_promo, v_items_total);
  end if;
  if v_items_total - v_discount + coalesce(p_ad_budget_amd, 0) <= 0 then
    raise exception 'order total must be positive';
  end if;

  insert into public.orders (
    business_id, client_id, billing, publishing, items_total_amd, ad_budget_amd, total_amd, notes,
    promo_code, discount_amd
  ) values (
    p_business_id, auth.uid(), p_billing, p_publishing, v_items_total, coalesce(p_ad_budget_amd, 0),
    v_items_total - v_discount + coalesce(p_ad_budget_amd, 0), nullif(trim(p_notes), ''),
    v_promo.code, v_discount
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, service_id, platform_id, quantity, unit_price_amd, line_total_amd)
  select v_order_id, service_id, platform_id, quantity, price, quantity * price
  from priced_items;

  return v_order_id;
end;
$$;


revoke execute on function public.create_order from public, anon;
grant execute on function public.create_order to authenticated;

-- ---------- Квитанции ----------

create sequence public.receipt_no_seq;

alter table public.payments add column receipt_no bigint unique;

update public.payments p
   set receipt_no = n.no
  from (
    select id, nextval('public.receipt_no_seq') as no
    from (select id from public.payments where status = 'succeeded' order by updated_at, id) s
  ) n
 where n.id = p.id;

-- Как раньше, плюс номер квитанции и учёт использования промокода (при первой оплате заказа).
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
  v_promo text;
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
         raw = p_raw,
         receipt_no = nextval('public.receipt_no_seq')
   where id = p_payment_id;

  update public.orders
     set status = 'paid', paid_at = now()
   where id = v_payment.order_id and status = 'pending_payment'
  returning promo_code into v_promo;

  if v_promo is not null then
    update public.promo_codes set used_count = used_count + 1 where code = v_promo;
  end if;

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
