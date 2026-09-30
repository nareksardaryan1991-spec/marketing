-- Вызовы Edge Functions из базы: уведомления сразу после записи в очередь
-- и автопубликация по расписанию. Адрес проекта и секреты берутся из Supabase Vault
-- (их кладёт scripts/setup.sh): project_url, notify_webhook_secret, autopublish_secret.
-- Пока секретов нет, вызовы тихо пропускаются — приложение работает и без них.

create function public.call_edge_function(
  p_function text,
  p_secret_name text,
  p_header text,
  p_body jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = p_secret_name;
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/' || p_function,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', p_header, v_secret)
  );
exception when others then
  -- Сбой доставки не должен ломать запись, которая его вызвала.
  raise warning 'call_edge_function(%) failed: %', p_function, sqlerrm;
end;
$$;

revoke execute on function public.call_edge_function from public, anon, authenticated;

create function public.dispatch_notification()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  perform public.call_edge_function(
    'notify-dispatch',
    'notify_webhook_secret',
    'x-webhook-secret',
    jsonb_build_object('type', 'INSERT', 'table', 'notifications', 'record', to_jsonb(new))
  );
  return new;
end;
$$;

-- pg_net и pg_cron есть в Supabase; в локальных тестах их может не быть.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    create trigger notifications_dispatch
      after insert on public.notifications
      for each row execute function public.dispatch_notification();
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'auto-publish',
      '*/5 * * * *',
      $cron$select public.call_edge_function('auto-publish', 'autopublish_secret', 'x-cron-secret')$cron$
    );
  end if;
end;
$$;
