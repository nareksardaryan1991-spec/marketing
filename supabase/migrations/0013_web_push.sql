-- Web push: уведомления в браузер и в сайт, добавленный на экран «Домой» (iPhone с iOS 16.4+).
-- У пользователя может быть несколько устройств, поэтому подписки — отдельная таблица.
-- Отправляет их notify-dispatch вместе с Telegram и push приложения.

create table public.web_push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index web_push_subscriptions_user_id_idx on public.web_push_subscriptions (user_id);

-- Напрямую таблицу не читает и не меняет никто, кроме сервера: только через функции ниже.
alter table public.web_push_subscriptions enable row level security;
revoke all on public.web_push_subscriptions from anon, authenticated;

-- Сохраняет подписку браузера за текущим пользователем. Если в этом браузере раньше
-- входил кто-то другой, подписка переходит к новому пользователю.
create function public.save_web_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'invalid subscription';
  end if;
  insert into public.web_push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

-- Отписка при выходе из аккаунта: уведомления не должны приходить на чужое устройство.
create function public.delete_web_push_subscription(p_endpoint text)
returns void
language sql
security definer set search_path = ''
as $$
  delete from public.web_push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke execute on function public.save_web_push_subscription from public, anon;
grant execute on function public.save_web_push_subscription to authenticated;
revoke execute on function public.delete_web_push_subscription from public, anon;
grant execute on function public.delete_web_push_subscription to authenticated;
