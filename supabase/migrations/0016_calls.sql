-- Звонки в чатах (этап 2): кнопки 📞 и 🎥 создают комнату Jitsi и пишут в чат сообщение-звонок
-- с кнопкой «Присоединиться». Собеседник получает уведомление incoming_call со ссылкой.
-- Храним только имя комнаты: адрес сервера звонков задаётся в приложении и в notify-dispatch
-- (по умолчанию https://meet.jit.si), так в уведомление нельзя подсунуть чужую ссылку.

alter table public.messages
  add column call jsonb check (
    call is null or (
      call ->> 'room' ~ '^marketing-[a-z0-9]{20}$' and jsonb_typeof(call -> 'video') = 'boolean'
    )
  ),
  drop constraint messages_content_check,
  add constraint messages_content_check check (
    char_length(body) <= 4000
    and jsonb_typeof(attachments) = 'array'
    and (length(trim(body)) > 0 or jsonb_array_length(attachments) > 0 or call is not null or deleted_at is not null)
  );

alter table public.team_messages
  add column call jsonb check (
    call is null or (
      call ->> 'room' ~ '^marketing-[a-z0-9]{20}$' and jsonb_typeof(call -> 'video') = 'boolean'
    )
  ),
  drop constraint team_messages_content_check,
  add constraint team_messages_content_check check (
    char_length(body) <= 4000
    and jsonb_typeof(attachments) = 'array'
    and (length(trim(body)) > 0 or jsonb_array_length(attachments) > 0 or call is not null or deleted_at is not null)
  );

create or replace function public.prepare_chat_message()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_column text := case tg_table_name when 'messages' then 'order_id' else 'conversation_id' end;
  v_chat_id uuid := (to_jsonb(new) ->> v_column)::uuid;
  v_found boolean;
begin
  new.body := trim(coalesce(new.body, ''));
  new.attachments := public.clean_chat_attachments(new.attachments);
  new.forwarded_from := nullif(current_setting('app.forward_from', true), '');
  new.edited_at := null;
  -- Звонок: только комната и вид (аудио/видео), остальное отбрасываем.
  if new.call is not null then
    new.call := jsonb_build_object('room', new.call -> 'room', 'video', coalesce(new.call -> 'video', 'false'::jsonb));
  end if;
  new.deleted_at := null;
  if new.reply_to_id is not null then
    execute format('select exists (select 1 from public.%I where id = $1 and %I = $2)', tg_table_name, v_column)
      into v_found using new.reply_to_id, v_chat_id;
    if not v_found then
      new.reply_to_id := null;
    end if;
  end if;
  return new;
end;
$$;

-- Удалённый звонок тоже исчезает: кнопка «Присоединиться» больше не видна.
create or replace function public.clear_deleted_call()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    new.call := null;
  end if;
  return new;
end;
$$;

create trigger messages_clear_deleted_call
  before update on public.messages
  for each row execute function public.clear_deleted_call();

create trigger team_messages_clear_deleted_call
  before update on public.team_messages
  for each row execute function public.clear_deleted_call();

-- В списке чатов последний звонок показывается как «📞 Звонок».
create or replace function public.my_chats()
returns table (
  chat text,
  id uuid,
  kind text,
  title text,
  business_name text,
  order_created_at timestamptz,
  peer_id uuid,
  peer_role public.user_role,
  avatar_path text,
  last_seen_at timestamptz,
  last_message_at timestamptz,
  last_body text,
  last_author text,
  last_author_id uuid,
  last_attachment text,
  last_deleted boolean,
  unread integer,
  others_read_at timestamptz
)
language sql
stable
security definer set search_path = ''
as $$
  select
    'order', o.id, 'order', b.name, b.name, o.created_at,
    case when o.client_id = auth.uid() then null else o.client_id end,
    null::public.user_role,
    case when o.client_id = auth.uid() then null else client.avatar_path end,
    case when o.client_id = auth.uid() then null else client.last_seen_at end,
    last.created_at,
    last.body, last.author_name, last.author_id, case when last.call is not null then 'call' else last.attachments -> 0 ->> 'kind' end,
    last.deleted_at is not null,
    (select count(*)::integer from public.messages m
      where m.order_id = o.id and m.author_id <> auth.uid() and m.deleted_at is null
        and m.created_at > coalesce(
          (select r.last_read_at from public.order_chat_reads r
            where r.order_id = o.id and r.user_id = auth.uid()),
          '-infinity'::timestamptz)),
    public.chat_others_read_at('order', o.id)
  from public.orders o
  join public.businesses b on b.id = o.business_id
  join public.profiles client on client.id = o.client_id
  left join lateral (
    select m.* from public.messages m where m.order_id = o.id order by m.created_at desc limit 1
  ) last on true
  where o.client_id = auth.uid()
     or (public.is_team() and last.id is not null)

  union all

  select
    'team', c.id, c.kind::text, c.other_name, null, null,
    c.other_user_id, c.other_role, other.avatar_path, other.last_seen_at,
    last.created_at,
    last.body, last.author_name, last.author_id, case when last.call is not null then 'call' else last.attachments -> 0 ->> 'kind' end,
    last.deleted_at is not null,
    (select count(*)::integer from public.team_messages tm
      where tm.conversation_id = c.id and tm.author_id <> auth.uid() and tm.deleted_at is null
        and tm.created_at > coalesce(
          (select mm.last_read_at from public.conversation_members mm
            where mm.conversation_id = c.id and mm.user_id = auth.uid()),
          '-infinity'::timestamptz)),
    public.chat_others_read_at('team', c.id)
  from public.my_conversations() c
  left join public.profiles other on other.id = c.other_user_id
  left join lateral (
    select tm.* from public.team_messages tm
    where tm.conversation_id = c.id order by tm.created_at desc limit 1
  ) last on true

  order by 11 desc nulls last;
$$;

-- ---------- Уведомление «Вам звонят» ----------

create or replace function public.on_message_created()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_payload jsonb := jsonb_build_object(
    'order_id', new.order_id,
    'author', new.author_name,
    'preview', public.chat_preview(new.body, new.attachments),
    'business', (
      select b.name from public.orders o join public.businesses b on b.id = o.business_id
      where o.id = new.order_id
    )
  );
begin
  if new.call is not null then
    v_payload := v_payload || jsonb_build_object('room', new.call ->> 'room', 'video', new.call -> 'video');
    perform public.notify_users(
      case when new.from_client then public.manager_ids()
           else array[(select client_id from public.orders where id = new.order_id)] end,
      'incoming_call',
      v_payload
    );
    return new;
  end if;
  if new.from_client then
    perform public.notify_users(public.manager_ids(), 'client_message', v_payload);
  else
    perform public.notify_users(
      array[(select client_id from public.orders where id = new.order_id)],
      'team_message',
      v_payload
    );
  end if;
  return new;
end;
$$;

create or replace function public.on_team_message_created()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_kind public.conversation_kind;
  v_recipients uuid[];
begin
  update public.conversations set last_message_at = new.created_at
  where id = new.conversation_id
  returning kind into v_kind;

  if v_kind = 'team' then
    select coalesce(array_agg(id), '{}') into v_recipients
    from public.profiles
    where public.is_team_role(role) and id <> new.author_id;
  else
    select coalesce(array_agg(user_id), '{}') into v_recipients
    from public.conversation_members
    where conversation_id = new.conversation_id and user_id <> new.author_id;
  end if;

  perform public.notify_users(
    v_recipients,
    case when new.call is not null then 'incoming_call' else 'team_chat_message' end,
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      'channel', v_kind,
      'author', new.author_name,
      'preview', public.chat_preview(new.body, new.attachments)
    ) || case when new.call is not null
      then jsonb_build_object('room', new.call ->> 'room', 'video', new.call -> 'video')
      else '{}'::jsonb end
  );
  return new;
end;
$$;
