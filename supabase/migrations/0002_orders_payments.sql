-- Этап 2: каталог услуг, заказы, оплата, задачи.

-- Каталог услуг. Цены в драмах; название и описание — на трёх языках.
create table public.services (
  id text primary key,
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  price_amd integer not null check (price_amd >= 0),
  sort_order integer not null default 0,
  active boolean not null default true
);

-- ВРЕМЕННЫЕ цены — поменяйте на реальные (Table Editor → services).
insert into public.services (id, name, description, price_amd, sort_order) values
  ('post',
   '{"ru": "Пост", "hy": "Գրառում", "en": "Post"}',
   '{"ru": "Фото или дизайн + текст", "hy": "Լուսանկար կամ դիզայն + տեքստ", "en": "Photo or design + caption"}',
   8000, 10),
  ('reel',
   '{"ru": "Рилс", "hy": "Ռիլս", "en": "Reel"}',
   '{"ru": "Короткое вертикальное видео", "hy": "Կարճ ուղղահայաց տեսանյութ", "en": "Short vertical video"}',
   25000, 20),
  ('story',
   '{"ru": "История", "hy": "Սթորի", "en": "Story"}',
   '{"ru": "Сторис для Instagram / Facebook", "hy": "Սթորի Instagram / Facebook-ի համար", "en": "Instagram / Facebook story"}',
   4000, 30),
  ('ads_management',
   '{"ru": "Настройка рекламы", "hy": "Գովազդի կարգավորում", "en": "Ad campaign setup"}',
   '{"ru": "Запуск и ведение таргетированной рекламы", "hy": "Թիրախային գովազդի գործարկում և վարում", "en": "Launch and manage targeted ads"}',
   30000, 40),
  ('video_shoot',
   '{"ru": "Выезд на съёмку", "hy": "Նկարահանում տեղում", "en": "On-site shoot"}',
   '{"ru": "Наш видеограф приезжает и снимает", "hy": "Մեր վիդեոօպերատորը գալիս և նկարահանում է", "en": "Our videographer comes and films"}',
   40000, 50);

create type public.order_status as enum (
  'pending_payment',
  'paid',
  'in_progress',
  'completed',
  'cancelled'
);

create type public.billing_type as enum ('one_time', 'monthly');

-- Кто публикует готовые материалы.
create type public.publishing_mode as enum ('team', 'auto', 'client');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  billing public.billing_type not null,
  publishing public.publishing_mode not null default 'team',
  status public.order_status not null default 'pending_payment',
  items_total_amd integer not null check (items_total_amd >= 0),
  -- Рекламный бюджет клиент платит через нас, он добавляется к сумме.
  ad_budget_amd integer not null default 0 check (ad_budget_amd >= 0),
  total_amd integer not null check (total_amd > 0),
  notes text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index orders_client_id_idx on public.orders (client_id);
create index orders_business_id_idx on public.orders (business_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  service_id text not null references public.services (id),
  quantity integer not null check (quantity between 1 and 100),
  unit_price_amd integer not null,
  line_total_amd integer not null,
  unique (order_id, service_id)
);

create type public.payment_provider as enum ('arca', 'idram', 'test');
create type public.payment_status as enum ('created', 'succeeded', 'failed');

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  provider public.payment_provider not null,
  amount_amd integer not null,
  status public.payment_status not null default 'created',
  provider_payment_id text,
  return_url text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_order_id_idx on public.payments (order_id);

create type public.task_status as enum (
  'new',
  'assigned',
  'in_progress',
  'internal_review',
  'client_review',
  'changes_requested',
  'approved',
  'publishing',
  'published'
);

-- Одна единица работы, например «Пост №3». Создаются автоматически после оплаты.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  service_id text not null references public.services (id),
  number integer not null,
  status public.task_status not null default 'new',
  assignee_id uuid references public.profiles (id) on delete set null,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, service_id, number)
);

create index tasks_assignee_id_idx on public.tasks (assignee_id);
create index tasks_order_id_idx on public.tasks (order_id);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- Создание заказа. Цены считаются только здесь, на сервере, по каталогу.
-- p_items: [{"service_id": "post", "quantity": 10}, ...]
create function public.create_order(
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
  v_item_count integer;
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
      (item ->> 'quantity')::integer as quantity
    from jsonb_array_elements(p_items) as item;

  delete from requested_items where quantity is null or quantity <= 0;

  if exists (select 1 from requested_items where quantity > 100) then
    raise exception 'quantity too large';
  end if;

  if exists (
    select 1 from requested_items r
    left join public.services s on s.id = r.service_id and s.active
    where s.id is null
  ) then
    raise exception 'unknown service';
  end if;

  if exists (
    select service_id from requested_items group by service_id having count(*) > 1
  ) then
    raise exception 'duplicate service';
  end if;

  select count(*), coalesce(sum(r.quantity * s.price_amd), 0)
    into v_item_count, v_items_total
  from requested_items r
  join public.services s on s.id = r.service_id;

  if v_item_count = 0 then
    raise exception 'order is empty';
  end if;

  insert into public.orders (
    business_id, client_id, billing, publishing,
    items_total_amd, ad_budget_amd, total_amd, notes
  ) values (
    p_business_id, auth.uid(), p_billing, p_publishing,
    v_items_total, coalesce(p_ad_budget_amd, 0),
    v_items_total + coalesce(p_ad_budget_amd, 0), nullif(trim(p_notes), '')
  )
  returning id into v_order_id;

  insert into public.order_items (order_id, service_id, quantity, unit_price_amd, line_total_amd)
  select v_order_id, r.service_id, r.quantity, s.price_amd, r.quantity * s.price_amd
  from requested_items r
  join public.services s on s.id = r.service_id;

  return v_order_id;
end;
$$;

-- Успешная оплата: заказ → paid, создаются задачи. Повторный вызов ничего не делает.
-- Вызывается только из Edge Functions (service role).
create function public.mark_payment_succeeded(
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

  insert into public.tasks (order_id, business_id, service_id, number)
  select o.id, o.business_id, i.service_id, n
  from public.orders o
  join public.order_items i on i.order_id = o.id
  cross join lateral generate_series(1, i.quantity) as n
  where o.id = v_payment.order_id
  on conflict (order_id, service_id, number) do nothing;
end;
$$;

create function public.mark_payment_failed(p_payment_id uuid, p_raw jsonb)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.payments
     set status = 'failed', raw = p_raw
   where id = p_payment_id and status = 'created';
end;
$$;

revoke execute on function public.create_order from public, anon;
grant execute on function public.create_order to authenticated;
revoke execute on function public.mark_payment_succeeded from public, anon, authenticated;
revoke execute on function public.mark_payment_failed from public, anon, authenticated;
grant execute on function public.mark_payment_succeeded to service_role;
grant execute on function public.mark_payment_failed to service_role;

-- RLS
alter table public.services enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.tasks enable row level security;

create policy "services: read"
  on public.services for select
  to authenticated
  using (true);

create policy "services: manager writes"
  on public.services for all
  to authenticated
  using (public.is_manager())
  with check (public.is_manager());

-- Заказы создаются только через create_order, поэтому политики insert нет.
create policy "orders: read own or team"
  on public.orders for select
  using (client_id = auth.uid() or public.is_team());

create policy "orders: manager updates"
  on public.orders for update
  using (public.is_manager())
  with check (public.is_manager());

create policy "order_items: read with order"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and (o.client_id = auth.uid() or public.is_team())
    )
  );

-- Платежи пишут только Edge Functions (service role обходит RLS).
create policy "payments: read own or manager"
  on public.payments for select
  using (
    public.is_manager()
    or exists (select 1 from public.orders o where o.id = order_id and o.client_id = auth.uid())
  );

create policy "tasks: read"
  on public.tasks for select
  using (
    public.is_team()
    or assignee_id = auth.uid()
    or exists (select 1 from public.orders o where o.id = order_id and o.client_id = auth.uid())
  );

create policy "tasks: manager updates"
  on public.tasks for update
  using (public.is_manager())
  with check (public.is_manager());
