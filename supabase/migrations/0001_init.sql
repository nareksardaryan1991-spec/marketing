-- Этап 1: пользователи, роли и анкета бизнеса.

create type public.user_role as enum (
  'client',
  'manager',
  'designer',
  'videographer',
  'copywriter',
  'smm',
  'freelancer'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  role public.user_role not null default 'client',
  language text not null default 'ru' check (language in ('ru', 'hy', 'en')),
  created_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  industry text not null,
  city text,
  description text,
  target_audience text,
  tone text,
  goals text,
  competitors text,
  instagram_url text,
  facebook_url text,
  tiktok_url text,
  website_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index businesses_owner_id_idx on public.businesses (owner_id);

-- Профиль создаётся автоматически при регистрации.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, language)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'language', ''), 'ru')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

-- Хелперы для политик доступа.
create function public.my_role()
returns public.user_role
language sql
stable
security definer set search_path = ''
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Штатные сотрудники и менеджер. Фрилансеры сюда не входят:
-- они увидят только данные своих задач (этап 3).
create function public.is_team()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(
    public.my_role() in ('manager', 'designer', 'videographer', 'copywriter', 'smm'),
    false
  );
$$;

create function public.is_manager()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(public.my_role() = 'manager', false);
$$;

-- Смена роли — только менеджером.
create function public.set_user_role(target_user uuid, new_role public.user_role)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'only managers can change roles';
  end if;
  update public.profiles set role = new_role where id = target_user;
end;
$$;

-- RLS
alter table public.profiles enable row level security;
alter table public.businesses enable row level security;

create policy "profiles: read own or team"
  on public.profiles for select
  using (id = auth.uid() or public.is_team());

create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Пользователь не может сам поменять себе роль.
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone, language) on public.profiles to authenticated;

create policy "businesses: read own or team"
  on public.businesses for select
  using (owner_id = auth.uid() or public.is_team());

create policy "businesses: insert own"
  on public.businesses for insert
  with check (owner_id = auth.uid());

create policy "businesses: update own or manager"
  on public.businesses for update
  using (owner_id = auth.uid() or public.is_manager())
  with check (owner_id = auth.uid() or public.is_manager());
