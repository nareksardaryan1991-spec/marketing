-- Профиль бизнеса — «мозг» для AI-агентов: кроме анкеты, примеры удачных постов, логотип
-- и фирменные цвета. Всё это агенты получают в каждой задаче.

alter table public.businesses
  add column example_posts text check (char_length(example_posts) <= 4000),
  -- До пяти цветов в формате #RRGGBB.
  add column brand_colors text[] not null default '{}' check (
    cardinality(brand_colors) <= 5
    and array_to_string(brand_colors, ',') ~ '^(#[0-9A-Fa-f]{6}(,#[0-9A-Fa-f]{6})*)?$'
  ),
  -- Путь в bucket brand: <business_id>/logo-….png
  add column logo_path text check (logo_path like id::text || '/%');

-- Кто может менять профиль бизнеса (те же правила, что у update на businesses).
create function public.can_edit_business(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.businesses
    where id = p_business_id and (owner_id = auth.uid() or public.is_manager())
  );
$$;

-- Папка файла в bucket brand → id бизнеса (null, если имя не похоже на «<uuid>/…»).
create function public.brand_folder(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- Логотипы: публичный bucket (логотип показывают и в приложении, и на картинках агентов),
-- загружать и удалять может владелец бизнеса или менеджер — только в папку этого бизнеса.
insert into storage.buckets (id, name, public)
values ('brand', 'brand', true)
on conflict (id) do nothing;

create policy "brand: upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'brand' and public.can_edit_business(public.brand_folder(name)));

create policy "brand: read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'brand' and public.can_view_business(public.brand_folder(name)));

create policy "brand: delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'brand' and public.can_edit_business(public.brand_folder(name)));
