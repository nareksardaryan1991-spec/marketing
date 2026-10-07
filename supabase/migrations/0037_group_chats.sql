-- Групповые чаты команды: название, фото, участники; управляют создатель группы и владелец.
--
-- Группа — беседа kind = 'group' с участниками в conversation_members, как личная беседа: всё, что
-- проверяет участие (сообщения, файлы, реакции, «прочитано», звонки, уведомления), работает само.
--   * Создать группу может любой сотрудник агентства (не клиент и не ожидающий роли); участники — тоже
--     только сотрудники.
--   * Название, фото, добавить и удалить участника, удалить группу — создатель (created_by) и владелец,
--     если он в группе. Остальные переписываются и могут выйти. Создатель вышел — управление переходит
--     к самому давнему участнику; вышел последний — группа удаляется.
--   * Новый участник видит прежнюю переписку.
--   * Что менялось — служебные строки в самом чате (team_messages.event): «создал(а) группу»,
--     «добавил(а) …», «удалил(а) …», «вышел(а)», «новое название», «новое фото». Пишет их только сервер.

alter table public.conversations
  add column title text check (title is null or length(trim(title)) between 1 and 80),
  add column avatar_path text,
  add column created_by uuid references public.profiles (id) on delete set null,
  add constraint conversations_group_title check ((kind = 'group') = (title is not null));

alter table public.conversation_members
  add column joined_at timestamptz not null default now();

alter table public.team_messages
  add column event jsonb check (event is null or jsonb_typeof(event -> 'type') = 'string'),
  drop constraint team_messages_content_check,
  add constraint team_messages_content_check check (
    char_length(body) <= 4000
    and jsonb_typeof(attachments) = 'array'
    and (length(trim(body)) > 0 or jsonb_array_length(attachments) > 0 or call is not null
      or deleted_at is not null or event is not null)
  );

-- Служебные строки пишет только сервер (функции групп ставят app.group_event), и их нельзя
-- изменить или удалить как обычное сообщение.
create function public.guard_group_event()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.event is not null then
      raise exception 'service messages cannot be changed';
    end if;
    new.event := null;
  elsif new.event is not null and coalesce(current_setting('app.group_event', true), '') <> 'on' then
    raise exception 'service messages are written by the server';
  end if;
  return new;
end;
$$;

create trigger team_messages_guard_event
  before insert or update on public.team_messages
  for each row execute function public.guard_group_event();

create function public.post_group_event(p_conversation_id uuid, p_event jsonb)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  perform set_config('app.group_event', 'on', true);
  insert into public.team_messages (conversation_id, author_id, event)
  values (p_conversation_id, auth.uid(), p_event);
  perform set_config('app.group_event', '', true);
end;
$$;

-- ---------- Проверки ----------

create function public.person_name(p_user_id uuid)
returns text
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(nullif(trim(full_name), ''), email, '') from public.profiles where id = p_user_id;
$$;

-- Участники группы — только сотрудники агентства.
create function public.check_group_people(p_users uuid[])
returns void
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from unnest(p_users) u
    where not exists (select 1 from public.profiles p where p.id = u and public.is_employee_role(p.role))
  ) then
    raise exception 'group members must be team members';
  end if;
end;
$$;

-- Группа, которой управляет текущий человек: не участник — «не найдена», участник без прав — отказ.
create function public.group_for_manage(p_conversation_id uuid)
returns public.conversations
language plpgsql
security definer set search_path = ''
as $$
declare
  v_group public.conversations;
begin
  select * into v_group from public.conversations
   where id = p_conversation_id and kind = 'group' for update;
  if not found or not exists (
    select 1 from public.conversation_members where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then
    raise exception 'chat not found';
  end if;
  if not (v_group.created_by = auth.uid() or public.is_admin()) then
    raise exception 'only the group creator or the owner can change the group';
  end if;
  return v_group;
end;
$$;

create function public.group_title(p_title text)
returns text
language plpgsql
immutable
as $$
begin
  if nullif(trim(p_title), '') is null then
    raise exception 'group name is required';
  end if;
  if length(trim(p_title)) > 80 then
    raise exception 'group name is too long';
  end if;
  return trim(p_title);
end;
$$;

-- ---------- Действия ----------

create function public.create_group_chat(p_title text, p_members uuid[])
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_others uuid[];
begin
  if not coalesce(public.is_employee_role(public.my_role()), false) then
    raise exception 'group chats are for the team only';
  end if;
  select coalesce(array_agg(distinct u), '{}') into v_others
    from unnest(coalesce(p_members, '{}')) u where u <> auth.uid();
  if cardinality(v_others) = 0 then
    raise exception 'add at least one colleague';
  end if;
  perform public.check_group_people(v_others);

  insert into public.conversations (kind, title, created_by)
  values ('group', public.group_title(p_title), auth.uid())
  returning id into v_id;
  insert into public.conversation_members (conversation_id, user_id)
  select v_id, u from unnest(v_others || auth.uid()) u;
  perform public.post_group_event(v_id, jsonb_build_object('type', 'created', 'title', public.group_title(p_title)));
  return v_id;
end;
$$;

create function public.rename_group_chat(p_conversation_id uuid, p_title text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_group public.conversations := public.group_for_manage(p_conversation_id);
  v_title text := public.group_title(p_title);
begin
  if v_title = v_group.title then
    return;
  end if;
  update public.conversations set title = v_title where id = p_conversation_id;
  perform public.post_group_event(p_conversation_id, jsonb_build_object('type', 'renamed', 'title', v_title));
end;
$$;

-- Фото группы лежит в bucket avatars, в папке того, кто его загрузил (как фото профиля). null — убрать.
create function public.set_group_photo(p_conversation_id uuid, p_path text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_group public.conversations := public.group_for_manage(p_conversation_id);
begin
  if p_path is not null and split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'photo must be uploaded by you';
  end if;
  if p_path is not distinct from v_group.avatar_path then
    return;
  end if;
  update public.conversations set avatar_path = p_path where id = p_conversation_id;
  perform public.post_group_event(
    p_conversation_id, jsonb_build_object('type', case when p_path is null then 'photo_removed' else 'photo' end)
  );
end;
$$;

create function public.add_group_members(p_conversation_id uuid, p_users uuid[])
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_added uuid[];
begin
  perform public.group_for_manage(p_conversation_id);
  perform public.check_group_people(coalesce(p_users, '{}'));
  with added as (
    insert into public.conversation_members (conversation_id, user_id)
    select distinct p_conversation_id, u from unnest(p_users) u
    on conflict do nothing
    returning user_id
  )
  select coalesce(array_agg(user_id), '{}') into v_added from added;
  if cardinality(v_added) = 0 then
    return;
  end if;
  perform public.post_group_event(p_conversation_id, jsonb_build_object(
    'type', 'added',
    'users', to_jsonb(v_added),
    'names', (select jsonb_agg(public.person_name(u)) from unnest(v_added) u)
  ));
end;
$$;

-- Создатель вышел или его удалили — управление переходит к самому давнему участнику.
create function public.ensure_group_creator(p_conversation_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation_id) then
    delete from public.conversations where id = p_conversation_id;
    return;
  end if;
  update public.conversations c
     set created_by = (
       select m.user_id from public.conversation_members m
        where m.conversation_id = p_conversation_id
        order by m.joined_at, m.user_id limit 1
     )
   where c.id = p_conversation_id
     and not exists (
       select 1 from public.conversation_members m
        where m.conversation_id = p_conversation_id and m.user_id = c.created_by
     );
end;
$$;

create function public.remove_group_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  perform public.group_for_manage(p_conversation_id);
  if p_user_id = auth.uid() then
    raise exception 'use leave_group_chat to leave';
  end if;
  if not public.is_admin() and exists (select 1 from public.profiles where id = p_user_id and role = 'admin') then
    raise exception 'only the owner can remove the owner';
  end if;
  delete from public.conversation_members where conversation_id = p_conversation_id and user_id = p_user_id;
  if not found then
    raise exception 'not a member of this group';
  end if;
  perform public.post_group_event(p_conversation_id, jsonb_build_object(
    'type', 'removed', 'users', jsonb_build_array(p_user_id), 'names', jsonb_build_array(public.person_name(p_user_id))
  ));
  perform public.ensure_group_creator(p_conversation_id);
end;
$$;

create function public.leave_group_chat(p_conversation_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  delete from public.conversation_members m
   using public.conversations c
   where c.id = m.conversation_id and c.kind = 'group'
     and m.conversation_id = p_conversation_id and m.user_id = auth.uid();
  if not found then
    raise exception 'chat not found';
  end if;
  perform public.post_group_event(p_conversation_id, jsonb_build_object('type', 'left'));
  perform public.ensure_group_creator(p_conversation_id);
end;
$$;

create function public.delete_group_chat(p_conversation_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  perform public.group_for_manage(p_conversation_id);
  delete from public.conversations where id = p_conversation_id;
end;
$$;

-- ---------- Список чатов, шапка чата, уведомления ----------

-- Название группы — вместо имени собеседника.
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
    coalesce(c.title, nullif(other.full_name, ''), other.email),
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

-- Общий список чатов: у группы — её фото, у последнего сообщения — служебная строка (last_event).
drop function public.my_chats();
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
  others_read_at timestamptz,
  last_event jsonb
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
    public.chat_others_read_at('order', o.id),
    null::jsonb
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
    c.other_user_id, c.other_role, coalesce(conv.avatar_path, other.avatar_path), other.last_seen_at,
    last.created_at,
    last.body, last.author_name, last.author_id, case when last.call is not null then 'call' else last.attachments -> 0 ->> 'kind' end,
    last.deleted_at is not null,
    (select count(*)::integer from public.team_messages tm
      where tm.conversation_id = c.id and tm.author_id <> auth.uid() and tm.deleted_at is null
        and tm.created_at > coalesce(
          (select mm.last_read_at from public.conversation_members mm
            where mm.conversation_id = c.id and mm.user_id = auth.uid()),
          '-infinity'::timestamptz)),
    public.chat_others_read_at('team', c.id),
    last.event
  from public.my_conversations() c
  join public.conversations conv on conv.id = c.id
  left join public.profiles other on other.id = c.other_user_id
  left join lateral (
    select tm.* from public.team_messages tm
    where tm.conversation_id = c.id order by tm.created_at desc limit 1
  ) last on true

  order by 11 desc nulls last;
$$;

-- Шапка чата: у группы — название, фото, участники (с ролью и «был(а) в сети»), кто управляет.
create or replace function public.chat_info(p_chat text, p_chat_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = ''
as $$
declare
  v_pinned jsonb;
  v_peer jsonb;
  v_members integer;
  v_member_list jsonb;
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
    elsif v_conversation.kind = 'group' then
      select count(*)::integer,
             jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', coalesce(nullif(p.full_name, ''), p.email), 'avatar_path', p.avatar_path,
               'accent_color', p.accent_color, 'role', p.role, 'job_title', p.job_title,
               'last_seen_at', p.last_seen_at
             ) order by p.id <> v_conversation.created_by, coalesce(nullif(p.full_name, ''), p.email))
        into v_members, v_member_list
      from public.conversation_members m join public.profiles p on p.id = m.user_id
      where m.conversation_id = p_chat_id;
    else
      select count(*)::integer into v_members from public.profiles p where public.is_team_role(p.role);
    end if;
  end if;

  return jsonb_build_object(
    'kind', case when p_chat = 'order' then 'order' else v_conversation.kind::text end,
    'title', case
      when p_chat = 'order' then (select b.name from public.businesses b where b.id = v_order.business_id)
      when v_conversation.kind = 'group' then v_conversation.title
      else v_peer ->> 'name'
    end,
    'avatar_path', v_conversation.avatar_path,
    'pinned', v_pinned,
    'peer', v_peer,
    'members', v_members,
    'member_list', v_member_list,
    'created_by', v_conversation.created_by,
    'can_manage', v_conversation.kind = 'group'
      and (v_conversation.created_by = auth.uid() or public.is_admin()),
    'others_read_at', public.chat_others_read_at(p_chat, p_chat_id)
  );
end;
$$;

-- Сообщение в группе — участникам (с названием группы); служебная строка — без уведомления,
-- кроме «добавил(а)»: добавленным приходит «Вас добавили в группу».
create or replace function public.on_team_message_created()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_conversation public.conversations;
  v_recipients uuid[];
begin
  update public.conversations set last_message_at = new.created_at
  where id = new.conversation_id
  returning * into v_conversation;

  if new.event is not null then
    if new.event ->> 'type' = 'added' then
      perform public.notify_users(
        array(select jsonb_array_elements_text(new.event -> 'users')::uuid),
        'group_added',
        jsonb_build_object('conversation_id', new.conversation_id, 'title', v_conversation.title, 'author', new.author_name)
      );
    end if;
    return new;
  end if;

  if v_conversation.kind = 'team' then
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
      'channel', v_conversation.kind,
      'title', v_conversation.title,
      'author', new.author_name,
      'preview', public.chat_preview(new.body, new.attachments)
    ) || case when new.call is not null
      then jsonb_build_object('room', new.call ->> 'room', 'video', new.call -> 'video')
      else '{}'::jsonb end
  );
  return new;
end;
$$;

revoke execute on function public.guard_group_event, public.post_group_event, public.person_name,
  public.check_group_people, public.group_for_manage, public.ensure_group_creator
  from public, anon, authenticated;
revoke execute on function public.create_group_chat, public.rename_group_chat, public.set_group_photo,
  public.add_group_members, public.remove_group_member, public.leave_group_chat, public.delete_group_chat,
  public.my_chats
  from public, anon;
grant execute on function public.create_group_chat, public.rename_group_chat, public.set_group_photo,
  public.add_group_members, public.remove_group_member, public.leave_group_chat, public.delete_group_chat,
  public.my_chats
  to authenticated;
