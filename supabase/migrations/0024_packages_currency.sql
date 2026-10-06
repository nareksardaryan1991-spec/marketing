-- Пакеты на месяц и валюты.
-- 1. Пакет — набор услуг каталога (например, «12 постов Instagram + 8 сторис») с ценой за месяц.
--    Оформление пакета — обычный ежемесячный заказ: позиции по каталогу, а разница с ценой
--    пакета записывается как скидка (discount_amd). Оплата и продление — как у любого заказа.
-- 2. Валюты: клиент выбирает ֏, $ или € (profiles.currency); $ и € — для ориентира по курсу,
--    который задаёт владелец (agency_settings). Платят всегда в драмах.

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  name jsonb not null check (coalesce(name ->> 'ru', '') <> ''),
  description jsonb not null default '{}',
  price_amd integer not null check (price_amd > 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.package_items (
  package_id uuid not null references public.packages (id) on delete cascade,
  service_id text not null references public.services (id) on delete cascade,
  platform_id text references public.platforms (id) on delete cascade,
  quantity integer not null check (quantity between 1 and 100),
  unique nulls not distinct (package_id, service_id, platform_id)
);

alter table public.packages enable row level security;
alter table public.package_items enable row level security;

create policy "packages: read" on public.packages for select to authenticated
  using (active or public.is_manager());
create policy "packages: manager writes" on public.packages for all to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy "package_items: read" on public.package_items for select to authenticated
  using (exists (select 1 from public.packages p where p.id = package_id and (p.active or public.is_manager())));
create policy "package_items: manager writes" on public.package_items for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- ВРЕМЕННЫЕ пакеты и цены — владелец меняет их на экране «Услуги и цены».
with p as (
  insert into public.packages (name, description, price_amd, sort_order) values
    ('{"ru": "Старт", "hy": "Մեկնարկ", "en": "Start"}',
     '{"ru": "8 постов в Instagram в месяц: текст и картинка", "hy": "Ամսական 8 գրառում Instagram-ում՝ տեքստ և նկար", "en": "8 Instagram posts a month: text and image"}',
     56000, 10),
    ('{"ru": "12 постов в месяц", "hy": "Ամսական 12 գրառում", "en": "12 posts a month"}',
     '{"ru": "12 постов с картинками и 8 сторис в Instagram", "hy": "12 գրառում նկարներով և 8 սթորի Instagram-ում", "en": "12 posts with images and 8 stories on Instagram"}',
     110000, 20),
    ('{"ru": "Видео", "hy": "Տեսանյութ", "en": "Video"}',
     '{"ru": "8 постов и 4 рилса в Instagram в месяц", "hy": "Ամսական 8 գրառում և 4 ռիլս Instagram-ում", "en": "8 posts and 4 reels on Instagram a month"}',
     145000, 30)
  returning id, sort_order
)
insert into public.package_items (package_id, service_id, platform_id, quantity)
select p.id, i.service_id, 'instagram', i.quantity
from p
join (values (10, 'post', 8), (20, 'post', 12), (20, 'story', 8), (30, 'post', 8), (30, 'reel', 4))
  as i (sort_order, service_id, quantity) on i.sort_order = p.sort_order;

alter table public.orders add column package_id uuid references public.packages (id) on delete set null;

-- Оформить пакет: ежемесячный заказ по составу пакета, цена — цена пакета
-- (но не дороже, чем те же услуги по каталогу).
create function public.create_package_order(
  p_business_id uuid,
  p_package_id uuid,
  p_publishing public.publishing_mode,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package public.packages;
  v_order_id uuid;
  v_order public.orders;
  v_price integer;
begin
  select * into v_package from public.packages where id = p_package_id and active;
  if not found then
    raise exception 'package not found';
  end if;

  -- create_order сам проверит, что бизнес — клиента, и посчитает каталожную цену.
  v_order_id := public.create_order(
    p_business_id,
    (select jsonb_agg(jsonb_build_object('service_id', service_id, 'platform_id', platform_id, 'quantity', quantity))
       from public.package_items where package_id = p_package_id),
    'monthly',
    p_publishing,
    0,
    p_notes
  );
  select * into v_order from public.orders where id = v_order_id;

  v_price := least(v_package.price_amd, v_order.items_total_amd);
  update public.orders
     set package_id = p_package_id,
         discount_amd = v_order.items_total_amd - v_price,
         total_amd = v_price
   where id = v_order.id;
  return v_order.id;
end;
$$;

revoke execute on function public.create_package_order from public, anon;
grant execute on function public.create_package_order to authenticated;

-- «Повторить» пакетный заказ — снова по цене пакета, если пакет ещё есть.
create or replace function public.repeat_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id and client_id = auth.uid();
  if not found then
    raise exception 'order not found';
  end if;
  if v_order.package_id is not null
     and exists (select 1 from public.packages where id = v_order.package_id and active) then
    return public.create_package_order(v_order.business_id, v_order.package_id, v_order.publishing, v_order.notes);
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

-- Курс для показа цен в $ и € (сколько драмов за 1 единицу). Платят всегда в драмах.
alter table public.agency_settings
  add column usd_rate_amd numeric(10, 2) not null default 390 check (usd_rate_amd > 0),
  add column eur_rate_amd numeric(10, 2) not null default 420 check (eur_rate_amd > 0);

alter table public.profiles
  add column currency text not null default 'AMD' check (currency in ('AMD', 'USD', 'EUR'));
grant update (currency) on public.profiles to authenticated;
