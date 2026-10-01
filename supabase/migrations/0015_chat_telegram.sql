-- Чаты как в Telegram: фото, файлы и голосовые, ответ и пересылка, правка и удаление,
-- реакции, закреплённое сообщение, «прочитано», «был в сети», свой фон, общий список чатов.
-- Оба чата — по заказу (messages) и команды (team_messages) — умеют одно и то же.
-- В функциях чат задаётся парой: p_chat = 'order' + id заказа или 'team' + id беседы.

-- ---------- Доступ ----------

create function public.can_access_order_chat(p_order_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.is_order_client(p_order_id) or public.is_team();
$$;

create function public.can_access_chat(p_chat text, p_chat_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select case p_chat
    when 'order' then public.can_access_order_chat(p_chat_id)
    when 'team' then public.can_access_conversation(p_chat_id)
    else false
  end;
$$;

create function public.chat_table(p_chat text)
returns text
language plpgsql
immutable
as $$
begin
  if p_chat = 'order' then return 'messages'; end if;
  if p_chat = 'team' then return 'team_messages'; end if;
  raise exception 'unknown chat %', p_chat;
end;
$$;

-- ---------- Новые поля сообщений ----------
-- attachments: [{path, kind: photo|video|file|voice, name, mime, size, duration, width, height}]

alter table public.messages
  drop constraint messages_body_check,
  alter column body set default '',
  add column attachments jsonb not null default '[]'::jsonb,
  add column reply_to_id uuid references public.messages (id) on delete set null,
  add column forwarded_from text,
  add column edited_at timestamptz,
  add column deleted_at timestamptz,
  add constraint messages_content_check check (
    char_length(body) <= 4000
    and jsonb_typeof(attachments) = 'array'
    and (length(trim(body)) > 0 or jsonb_array_length(attachments) > 0 or deleted_at is not null)
  );

alter table public.team_messages
  drop constraint team_messages_body_check,
  alter column body set default '',
  add column attachments jsonb not null default '[]'::jsonb,
  add column reply_to_id uuid references public.team_messages (id) on delete set null,
  add column forwarded_from text,
  add column edited_at timestamptz,
  add column deleted_at timestamptz,
  add constraint team_messages_content_check check (
    char_length(body) <= 4000
    and jsonb_typeof(attachments) = 'array'
    and (length(trim(body)) > 0 or jsonb_array_length(attachments) > 0 or deleted_at is not null)
  );

create index messages_attachments_idx on public.messages using gin (attachments jsonb_path_ops);
create index team_messages_attachments_idx on public.team_messages using gin (attachments jsonb_path_ops);

-- ---------- Файлы чатов ----------
-- Приватный bucket. Путь: <order|team>/<id чата>/<id автора>/<файл>.
-- Загружать можно только в свою папку в доступном чате. Читать файл может тот, кто
-- видит сообщение с ним (так работает и пересылка в другой чат), сам автор и владелец.

insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', false)
on conflict (id) do nothing;

create function public.can_upload_chat_file(p_name text)
returns boolean
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  if array_length(v_parts, 1) <> 4 or v_parts[3] is distinct from auth.uid()::text
     or v_parts[2] !~ '^[0-9a-f-]{36}$' then
    return false;
  end if;
  return public.can_access_chat(v_parts[1], v_parts[2]::uuid);
end;
$$;

create function public.can_read_chat_file(p_name text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or split_part(p_name, '/', 3) = auth.uid()::text
    or exists (
      select 1 from public.messages m
      where m.attachments @> jsonb_build_array(jsonb_build_object('path', p_name))
        and public.can_access_order_chat(m.order_id)
    )
    or exists (
      select 1 from public.team_messages m
      where m.attachments @> jsonb_build_array(jsonb_build_object('path', p_name))
        and public.can_access_conversation(m.conversation_id)
    ),
    false
  );
$$;

create policy "chat files: upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'chat-files' and public.can_upload_chat_file(name));

create policy "chat files: read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'chat-files' and public.can_read_chat_file(name));

-- Проверка вложений: не больше 10, известные поля, файл уже загружен и доступен автору.
create function public.clean_chat_attachments(p_items jsonb)
returns jsonb
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  v_item jsonb;
  v_path text;
  v_result jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) = 'null' then
    return v_result;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 10 then
    raise exception 'invalid attachments';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_path := v_item ->> 'path';
    if v_path is null or coalesce(v_item ->> 'kind', '') not in ('photo', 'video', 'file', 'voice') then
      raise exception 'invalid attachment';
    end if;
    if not public.can_read_chat_file(v_path)
       or not exists (select 1 from storage.objects where bucket_id = 'chat-files' and name = v_path) then
      raise exception 'attachment not found';
    end if;
    v_result := v_result || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'path', v_path,
      'kind', v_item ->> 'kind',
      'name', left(coalesce(v_item ->> 'name', split_part(v_path, '/', 4)), 200),
      'mime', left(v_item ->> 'mime', 100),
      'size', (v_item ->> 'size')::bigint,
      'duration', round((v_item ->> 'duration')::numeric, 1),
      'width', (v_item ->> 'width')::integer,
      'height', (v_item ->> 'height')::integer
    )));
  end loop;
  return v_result;
end;
$$;

-- Перед вставкой: вложения проверены, ответ — только на сообщение этого же чата,
-- «Переслано от» ставит только forward_chat_message, правку и удаление — только функции.
create function public.prepare_chat_message()
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

create trigger messages_prepare
  before insert on public.messages
  for each row execute function public.prepare_chat_message();

create trigger team_messages_prepare
  before insert on public.team_messages
  for each row execute function public.prepare_chat_message();

-- Текст для уведомлений и списка чатов, когда в сообщении только вложение.
create function public.chat_preview(p_body text, p_attachments jsonb)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(left(p_body, 200), ''),
    case p_attachments -> 0 ->> 'kind'
      when 'photo' then '📷'
      when 'video' then '🎬'
      when 'voice' then '🎤'
      when 'file' then '📎 ' || (p_attachments -> 0 ->> 'name')
    end,
    ''
  );
$$;

-- ---------- Правка, удаление, пересылка ----------

create function public.edit_chat_message(p_chat text, p_message_id uuid, p_body text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  execute format(
    'update public.%I set body = trim($2), edited_at = now()
     where id = $1 and author_id = auth.uid() and deleted_at is null and body is distinct from trim($2)
     returning id',
    public.chat_table(p_chat)
  ) into v_id using p_message_id, coalesce(p_body, '');
  if v_id is null and not exists (
    select 1 from public.messages where id = p_message_id and author_id = auth.uid() and deleted_at is null
    union all
    select 1 from public.team_messages where id = p_message_id and author_id = auth.uid() and deleted_at is null
  ) then
    raise exception 'message not found';
  end if;
end;
$$;

-- Удалённое исчезает у всех; оригинал сохраняется здесь, его видит только владелец.
create table public.deleted_chat_messages (
  message_id uuid primary key,
  chat text not null check (chat in ('order', 'team')),
  chat_id uuid not null,
  author_id uuid,
  author_name text not null,
  body text not null,
  attachments jsonb not null,
  created_at timestamptz not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid default auth.uid()
);

create index deleted_chat_messages_chat_idx on public.deleted_chat_messages (chat_id);

alter table public.deleted_chat_messages enable row level security;

create policy "deleted_chat_messages: owner reads"
  on public.deleted_chat_messages for select
  using (public.is_admin());

create function public.delete_chat_message(p_chat text, p_message_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_table text := public.chat_table(p_chat);
  v_row jsonb;
  v_chat_id uuid;
begin
  execute format('select to_jsonb(m) from public.%I m where id = $1 and deleted_at is null', v_table)
    into v_row using p_message_id;
  if v_row is null then
    raise exception 'message not found';
  end if;
  v_chat_id := coalesce(v_row ->> 'order_id', v_row ->> 'conversation_id')::uuid;
  if not public.can_access_chat(p_chat, v_chat_id)
     or ((v_row ->> 'author_id')::uuid is distinct from auth.uid() and not public.is_admin()) then
    raise exception 'only the author can delete a message';
  end if;

  insert into public.deleted_chat_messages
    (message_id, chat, chat_id, author_id, author_name, body, attachments, created_at)
  values (
    p_message_id, p_chat, v_chat_id, (v_row ->> 'author_id')::uuid, v_row ->> 'author_name',
    v_row ->> 'body', v_row -> 'attachments', (v_row ->> 'created_at')::timestamptz
  );

  execute format(
    'update public.%I set body = '''', attachments = ''[]''::jsonb, forwarded_from = null,
       edited_at = null, deleted_at = now() where id = $1',
    v_table
  ) using p_message_id;
  delete from public.chat_reactions where message_id = p_message_id;
  update public.orders set pinned_message_id = null where pinned_message_id = p_message_id;
  update public.conversations set pinned_message_id = null where pinned_message_id = p_message_id;
end;
$$;

-- Пересылка: копия текста и вложений в другой доступный чат с подписью «Переслано от …».
create function public.forward_chat_message(
  p_from_chat text,
  p_message_id uuid,
  p_to_chat text,
  p_to_chat_id uuid
)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_row jsonb;
  v_id uuid;
begin
  execute format('select to_jsonb(m) from public.%I m where id = $1 and deleted_at is null',
    public.chat_table(p_from_chat))
    into v_row using p_message_id;
  if v_row is null
     or not public.can_access_chat(p_from_chat, coalesce(v_row ->> 'order_id', v_row ->> 'conversation_id')::uuid)
  then
    raise exception 'message not found';
  end if;
  if not public.can_access_chat(p_to_chat, p_to_chat_id) then
    raise exception 'chat not found';
  end if;

  -- Пересылка пересланного сохраняет первого автора.
  perform set_config('app.forward_from', coalesce(v_row ->> 'forwarded_from', v_row ->> 'author_name'), true);
  if p_to_chat = 'order' then
    insert into public.messages (order_id, author_id, body, attachments)
    values (p_to_chat_id, auth.uid(), v_row ->> 'body', v_row -> 'attachments')
    returning id into v_id;
  else
    insert into public.team_messages (conversation_id, author_id, body, attachments)
    values (p_to_chat_id, auth.uid(), v_row ->> 'body', v_row -> 'attachments')
    returning id into v_id;
  end if;
  perform set_config('app.forward_from', '', true);
  return v_id;
end;
$$;

-- ---------- Реакции ----------
-- Одна реакция от человека на сообщение, как в Telegram. Имя копируется:
-- клиент не видит профили команды.

create table public.chat_reactions (
  message_id uuid not null,
  chat text not null check (chat in ('order', 'team')),
  chat_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  user_name text not null default '',
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index chat_reactions_chat_idx on public.chat_reactions (chat_id);

alter table public.chat_reactions enable row level security;

create policy "chat_reactions: read"
  on public.chat_reactions for select
  using (public.can_access_chat(chat, chat_id));

-- Та же реакция ещё раз (или null) — убрать.
create function public.react_to_message(p_chat text, p_message_id uuid, p_emoji text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_chat_id uuid;
begin
  execute format(
    'select %I from public.%I where id = $1 and deleted_at is null',
    case p_chat when 'order' then 'order_id' else 'conversation_id' end,
    public.chat_table(p_chat)
  ) into v_chat_id using p_message_id;
  if v_chat_id is null or not public.can_access_chat(p_chat, v_chat_id) then
    raise exception 'message not found';
  end if;

  if p_emoji is null or exists (
    select 1 from public.chat_reactions
    where message_id = p_message_id and user_id = auth.uid() and emoji = p_emoji
  ) then
    delete from public.chat_reactions where message_id = p_message_id and user_id = auth.uid();
    return;
  end if;

  insert into public.chat_reactions (message_id, chat, chat_id, user_id, user_name, emoji)
  select p_message_id, p_chat, v_chat_id, auth.uid(), coalesce(nullif(full_name, ''), email, ''), p_emoji
  from public.profiles where id = auth.uid()
  on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
end;
$$;

-- Сообщение удалили вместе с заказом или беседой — реакции тоже.
create function public.drop_message_reactions()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  delete from public.chat_reactions where message_id = old.id;
  return old;
end;
$$;

create trigger messages_drop_reactions
  after delete on public.messages
  for each row execute function public.drop_message_reactions();

create trigger team_messages_drop_reactions
  after delete on public.team_messages
  for each row execute function public.drop_message_reactions();

-- ---------- Закреплённое сообщение ----------

alter table public.orders
  add column pinned_message_id uuid references public.messages (id) on delete set null;
alter table public.conversations
  add column pinned_message_id uuid references public.team_messages (id) on delete set null;

-- p_message_id = null — открепить.
create function public.pin_chat_message(p_chat text, p_chat_id uuid, p_message_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.can_access_chat(p_chat, p_chat_id) then
    raise exception 'chat not found';
  end if;
  if p_chat = 'order' then
    if p_message_id is not null and not exists (
      select 1 from public.messages where id = p_message_id and order_id = p_chat_id and deleted_at is null
    ) then
      raise exception 'message not found';
    end if;
    update public.orders set pinned_message_id = p_message_id where id = p_chat_id;
  else
    if p_message_id is not null and not exists (
      select 1 from public.team_messages
      where id = p_message_id and conversation_id = p_chat_id and deleted_at is null
    ) then
      raise exception 'message not found';
    end if;
    update public.conversations set pinned_message_id = p_message_id where id = p_chat_id;
  end if;
end;
$$;

-- ---------- Прочитано и «был в сети» ----------

create table public.order_chat_reads (
  order_id uuid not null references public.orders (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (order_id, user_id)
);

alter table public.order_chat_reads enable row level security;

create policy "order_chat_reads: read own"
  on public.order_chat_reads for select
  using (user_id = auth.uid());

create function public.mark_chat_read(p_chat text, p_chat_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if p_chat = 'team' then
    perform public.mark_conversation_read(p_chat_id);
    return;
  end if;
  if not public.can_access_chat(p_chat, p_chat_id) then
    raise exception 'chat not found';
  end if;
  insert into public.order_chat_reads (order_id, user_id, last_read_at)
  values (p_chat_id, auth.uid(), now())
  on conflict (order_id, user_id) do update set last_read_at = now();
end;
$$;

-- До какого момента чат прочитал собеседник (для двух галочек). В чате заказа
-- «собеседник» — другая сторона: для клиента команда, для команды клиент.
create function public.chat_others_read_at(p_chat text, p_chat_id uuid)
returns timestamptz
language sql
stable
security definer set search_path = ''
as $$
  select case p_chat
    when 'team' then (
      select max(m.last_read_at) from public.conversation_members m
      where m.conversation_id = p_chat_id and m.user_id <> auth.uid()
    )
    else (
      select max(r.last_read_at)
      from public.order_chat_reads r
      join public.orders o on o.id = r.order_id
      where r.order_id = p_chat_id
        and r.user_id <> auth.uid()
        and ((o.client_id = auth.uid()) = (r.user_id <> o.client_id))
    )
  end;
$$;

alter table public.profiles
  add column last_seen_at timestamptz,
  add column chat_wallpaper text check (
    chat_wallpaper ~ '^(preset:[a-z0-9-]{1,30}|photo:[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100})$'
  );

grant update (chat_wallpaper) on public.profiles to authenticated;

create function public.touch_last_seen()
returns void
language sql
security definer set search_path = ''
as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

-- Шапка открытого чата: закреплённое, «прочитано», собеседник и его «был в сети».
create function public.chat_info(p_chat text, p_chat_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  v_pinned jsonb;
  v_peer jsonb;
  v_members integer;
  v_order public.orders;
  v_conversation public.conversations;
begin
  if not public.can_access_chat(p_chat, p_chat_id) then
    raise exception 'chat not found';
  end if;

  if p_chat = 'order' then
    select * into v_order from public.orders where id = p_chat_id;
    select jsonb_build_object('id', m.id, 'body', m.body, 'attachments', m.attachments, 'author_name', m.author_name)
      into v_pinned
    from public.messages m where m.id = v_order.pinned_message_id and m.deleted_at is null;
    if v_order.client_id = auth.uid() then
      -- Клиенту — не люди, а «команда»: была ли в сети хоть кто-то из штатных.
      select jsonb_build_object('last_seen_at', max(p.last_seen_at)) into v_peer
      from public.profiles p where public.is_team_role(p.role);
    else
      select jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), p.email),
          'avatar_path', p.avatar_path, 'last_seen_at', p.last_seen_at)
        into v_peer
      from public.profiles p where p.id = v_order.client_id;
    end if;
  else
    select * into v_conversation from public.conversations where id = p_chat_id;
    select jsonb_build_object('id', m.id, 'body', m.body, 'attachments', m.attachments, 'author_name', m.author_name)
      into v_pinned
    from public.team_messages m where m.id = v_conversation.pinned_message_id and m.deleted_at is null;
    if v_conversation.kind = 'direct' then
      select jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), p.email),
          'avatar_path', p.avatar_path, 'role', p.role, 'last_seen_at', p.last_seen_at)
        into v_peer
      from public.conversation_members m join public.profiles p on p.id = m.user_id
      where m.conversation_id = p_chat_id and m.user_id <> auth.uid()
      limit 1;
    else
      select count(*)::integer into v_members from public.profiles p where public.is_team_role(p.role);
    end if;
  end if;

  return jsonb_build_object(
    'title', case
      when p_chat = 'order' then (select b.name from public.businesses b where b.id = v_order.business_id)
      else v_peer ->> 'name'
    end,
    'pinned', v_pinned,
    'peer', v_peer,
    'members', v_members,
    'others_read_at', public.chat_others_read_at(p_chat, p_chat_id)
  );
end;
$$;

-- ---------- Общий список чатов ----------
-- Клиент: чаты своих заказов. Штатные: общий чат, личные беседы и чаты заказов, где уже
-- есть сообщения. Фрилансер: только личные беседы.
create function public.my_chats()
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
    last.body, last.author_name, last.author_id, last.attachments -> 0 ->> 'kind',
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
    last.body, last.author_name, last.author_id, last.attachments -> 0 ->> 'kind',
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

-- Счётчик на кнопке «Чаты» и в списке бесед команды: удалённые не считаются.
create or replace function public.my_conversations()
returns table (
  id uuid,
  kind public.conversation_kind,
  other_user_id uuid,
  other_name text,
  other_role public.user_role,
  last_message_at timestamptz,
  last_body text,
  last_author text,
  unread integer
)
language sql
stable
security definer set search_path = ''
as $$
  with mine as (
    select c.*
    from public.conversations c
    where (c.kind = 'team' and public.is_team())
       or exists (
         select 1 from public.conversation_members m
         where m.conversation_id = c.id and m.user_id = auth.uid()
       )
  )
  select
    c.id,
    c.kind,
    other.id,
    coalesce(nullif(other.full_name, ''), other.email),
    other.role,
    c.last_message_at,
    public.chat_preview(last.body, last.attachments),
    last.author_name,
    (select count(*)::integer
       from public.team_messages tm
       where tm.conversation_id = c.id
         and tm.author_id <> auth.uid()
         and tm.deleted_at is null
         and tm.created_at > coalesce(me.last_read_at, '-infinity'::timestamptz))
  from mine c
  left join public.conversation_members me
    on me.conversation_id = c.id and me.user_id = auth.uid()
  left join lateral (
    select p.* from public.conversation_members om
    join public.profiles p on p.id = om.user_id
    where om.conversation_id = c.id and om.user_id <> auth.uid()
    limit 1
  ) other on c.kind = 'direct'
  left join lateral (
    select tm.body, tm.attachments, tm.author_name from public.team_messages tm
    where tm.conversation_id = c.id
    order by tm.created_at desc
    limit 1
  ) last on true
  order by (c.kind = 'team') desc, c.last_message_at desc nulls last;
$$;

-- ---------- Уведомления: для вложений — значок вместо пустого текста ----------

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
    'team_chat_message',
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      'channel', v_kind,
      'author', new.author_name,
      'preview', public.chat_preview(new.body, new.attachments)
    )
  );
  return new;
end;
$$;

-- ---------- Права на функции и realtime ----------

revoke execute on function
  public.can_access_order_chat, public.can_access_chat, public.can_upload_chat_file,
  public.can_read_chat_file, public.clean_chat_attachments, public.edit_chat_message,
  public.delete_chat_message, public.forward_chat_message, public.react_to_message,
  public.pin_chat_message, public.mark_chat_read, public.chat_others_read_at,
  public.touch_last_seen, public.chat_info, public.my_chats
  from public, anon;
grant execute on function
  public.can_access_order_chat, public.can_access_chat, public.can_upload_chat_file,
  public.can_read_chat_file, public.edit_chat_message,
  public.delete_chat_message, public.forward_chat_message, public.react_to_message,
  public.pin_chat_message, public.mark_chat_read, public.chat_others_read_at,
  public.touch_last_seen, public.chat_info, public.my_chats
  to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_reactions;
  end if;
end;
$$;
