-- Отчёты: статистика Instagram по аккаунту и по нашим публикациям.
-- Собирает Edge Function collect-insights каждые 6 часов (истории Instagram отдаёт
-- только первые 24 часа, поэтому раз в сутки было бы мало).

-- Снимок аккаунта за день: подписчики и итоги за последние 30 дней.
create table public.account_snapshots (
  business_id uuid not null references public.businesses (id) on delete cascade,
  taken_on date not null,
  followers_count integer,
  media_count integer,
  -- {"reach": 1234, "views": 5678, "accounts_engaged": 90, ...}
  metrics_30d jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  primary key (business_id, taken_on)
);

-- Последние цифры по опубликованной задаче.
create table public.post_metrics (
  task_id uuid primary key references public.tasks (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  media_id text not null,
  permalink text,
  media_type text,
  -- {"reach": 800, "views": 1200, "likes": 40, "comments": 3, "saved": 5, "shares": 2, ...}
  metrics jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);

create index post_metrics_business_id_idx on public.post_metrics (business_id);

-- Почему статистика недоступна (например, аккаунт подключён без разрешения на статистику).
alter table public.social_accounts
  add column insights_error text,
  add column insights_updated_at timestamptz;

grant select (insights_error, insights_updated_at) on public.social_accounts to authenticated;

alter table public.account_snapshots enable row level security;
alter table public.post_metrics enable row level security;

create function public.can_view_business(p_business_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.is_team()
    or exists (select 1 from public.businesses where id = p_business_id and owner_id = auth.uid());
$$;

-- Пишет только сервер.
create policy "account_snapshots: read"
  on public.account_snapshots for select
  using (public.can_view_business(business_id));

create policy "post_metrics: read"
  on public.post_metrics for select
  using (public.can_view_business(business_id));

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'collect-insights',
      '15 */6 * * *',
      $cron$select public.call_edge_function('collect-insights', 'autopublish_secret', 'x-cron-secret')$cron$
    );
  end if;
end;
$$;
