-- Личный кабинет: каждый (клиент и сотрудник) сам меняет имя, фото, обложку, цвет и «о себе».

alter table public.profiles
  add column avatar_path text,
  add column cover_path text,
  add column accent_color text check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column bio text check (char_length(bio) <= 500);

grant update (avatar_path, cover_path, accent_color, bio) on public.profiles to authenticated;

-- Фото профилей: публичный bucket (фото показываются всем, кто видит профиль),
-- файлы лежат в папке <user_id>/ — загружать и удалять можно только в своей.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars: upload own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

create policy "avatars: read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars');

create policy "avatars: delete own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);
