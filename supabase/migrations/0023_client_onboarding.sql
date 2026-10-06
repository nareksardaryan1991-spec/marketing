-- Знакомство и кабинет клиента.
-- 1. Знакомство-разговор сохраняет ответы в профиль бизнеса после каждого вопроса;
--    onboarded_at отмечает, что знакомство пройдено (до этого клиент видит только его).
-- 2. Подарок после знакомства: AI делает 3 примера постов и контент-план на неделю —
--    один раз на клиента, показывается сразу с пометкой «черновик AI».
-- 3. Идеи задач от агентов: 2–3 в неделю по профилю; «Принять» создаёт заказ.
-- Пишет в welcome_kits / task_ideas только серверная функция client-ai (service_role).

alter table public.businesses add column onboarded_at timestamptz;
update public.businesses set onboarded_at = created_at;

create table public.welcome_kits (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  -- Один подарок на клиента, даже если он заведёт ещё один бизнес.
  client_id uuid not null unique references public.profiles (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  language text not null default 'ru' check (language in ('ru', 'hy', 'en')),
  -- { posts: [{ title, caption, image_idea, best_time }], plan: [{ day, format, topic }] }
  result jsonb,
  error text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.welcome_kits enable row level security;

create policy "welcome_kits: read"
  on public.welcome_kits for select
  using (public.can_view_business(business_id));

-- Неделя идей (понедельник по Еревану): строка появляется до вызова AI и не даёт
-- сгенерировать идеи дважды за неделю, даже если клиент откроет приложение в двух окнах.
create table public.idea_batches (
  business_id uuid not null references public.businesses (id) on delete cascade,
  week_start date not null,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  primary key (business_id, week_start)
);

alter table public.idea_batches enable row level security;

create policy "idea_batches: read"
  on public.idea_batches for select
  using (public.can_view_business(business_id));

create table public.task_ideas (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  week_start date not null,
  agent text not null check (agent in ('smm', 'designer', 'scriptwriter', 'targetologist', 'seo')),
  title text not null check (length(trim(title)) > 0),
  description text not null,
  service_id text not null references public.services (id),
  platform_id text references public.platforms (id),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'dismissed')),
  order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (business_id, week_start) references public.idea_batches (business_id, week_start) on delete cascade
);

create index task_ideas_business_idx on public.task_ideas (business_id, week_start desc);

alter table public.task_ideas enable row level security;

create policy "task_ideas: read"
  on public.task_ideas for select
  using (public.can_view_business(business_id));

-- «Принять» идею: обычный заказ из одной позиции (цена — по каталогу, как в create_order),
-- дальше клиент оплачивает его как любой другой.
create function public.accept_task_idea(p_idea_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_idea public.task_ideas;
  v_order uuid;
begin
  select i.* into v_idea
  from public.task_ideas i
  join public.businesses b on b.id = i.business_id
  where i.id = p_idea_id and b.owner_id = auth.uid()
  for update of i;
  if not found then
    raise exception 'idea not found';
  end if;
  if v_idea.status <> 'proposed' then
    raise exception 'idea is already decided';
  end if;

  v_order := public.create_order(
    v_idea.business_id,
    jsonb_build_array(jsonb_build_object(
      'service_id', v_idea.service_id, 'platform_id', v_idea.platform_id, 'quantity', 1)),
    'one_time',
    'team',
    0,
    v_idea.title || E'\n' || v_idea.description
  );

  update public.task_ideas
     set status = 'accepted', order_id = v_order, decided_at = now()
   where id = p_idea_id;
  return v_order;
end;
$$;

create function public.dismiss_task_idea(p_idea_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.task_ideas i
     set status = 'dismissed', decided_at = now()
    from public.businesses b
   where i.id = p_idea_id and b.id = i.business_id and b.owner_id = auth.uid() and i.status = 'proposed';
  if not found then
    raise exception 'idea not found';
  end if;
end;
$$;

revoke execute on function public.accept_task_idea, public.dismiss_task_idea from public, anon;
grant execute on function public.accept_task_idea, public.dismiss_task_idea to authenticated;
