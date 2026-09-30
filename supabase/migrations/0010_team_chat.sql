-- Внутренний чат команды: личные беседы между сотрудниками (включая фрилансеров)
-- и один общий чат штатной команды. Клиенты сюда доступа не имеют.

create type public.conversation_kind as enum ('direct', 'team');

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.conversation_kind not null,
  -- Для личной беседы: "<меньший id>:<больший id>" — одна беседа на пару.
  direct_key text unique,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  check ((kind = 'direct') = (direct_key is not null))
);

-- Общий чат команды — один, с постоянным id.
insert into public.conversations (id, kind)
values ('00000000-0000-4000-8000-00000000c0de', 'team');

-- Участники личных бесед и отметка «прочитано до» (для общего чата строка
-- появляется при первом прочтении).
create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);

create index conversation_members_user_id_idx on public.conversation_members (user_id);

create table public.team_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id),
  author_name text not null default '',
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index team_messages_conversation_idx on public.team_messages (conversation_id, created_at);

-- Общий чат — для штатных (is_team), личная беседа — для её участников.
create function public.can_access_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select coalesce(
    (select case c.kind
       when 'team' then public.is_team()
       else exists (
         select 1 from public.conversation_members m
         where m.conversation_id = c.id and m.user_id = auth.uid()
       )
     end
     from public.conversations c where c.id = p_conversation_id),
    false
  );
$$;

-- Открыть (или создать) личную беседу с коллегой.
create function public.open_direct_conversation(p_user_id uuid)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_key text;
  v_id uuid;
begin
  if coalesce(public.my_role() = 'client', true) then
    raise exception 'team chat is for the team only';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot chat with yourself';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and role <> 'client') then
    raise exception 'colleague not found';
  end if;

  v_key := least(auth.uid()::text, p_user_id::text) || ':' || greatest(auth.uid()::text, p_user_id::text);

  insert into public.conversations (kind, direct_key)
  values ('direct', v_key)
  on conflict (direct_key) do nothing;

  select id into v_id from public.conversations where direct_key = v_key;

  insert into public.conversation_members (conversation_id, user_id)
  values (v_id, auth.uid()), (v_id, p_user_id)
  on conflict do nothing;

  return v_id;
end;
$$;

create function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.can_access_conversation(p_conversation_id) then
    raise exception 'conversation not found';
  end if;
  insert into public.conversation_members (conversation_id, user_id, last_read_at)
  values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();
end;
$$;

-- Список бесед текущего пользователя: общий чат (если штатный) + личные,
-- с именем собеседника, последним сообщением и числом непрочитанных.
create function public.my_conversations()
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
    last.body,
    last.author_name,
    (select count(*)::integer
       from public.team_messages tm
       where tm.conversation_id = c.id
         and tm.author_id <> auth.uid()
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
    select tm.body, tm.author_name from public.team_messages tm
    where tm.conversation_id = c.id
    order by tm.created_at desc
    limit 1
  ) last on true
  order by (c.kind = 'team') desc, c.last_message_at desc nulls last;
$$;

revoke execute on function public.open_direct_conversation, public.mark_conversation_read, public.my_conversations
  from public, anon;
grant execute on function public.open_direct_conversation, public.mark_conversation_read, public.my_conversations
  to authenticated;

-- Имя автора копируется при отправке, время последнего сообщения обновляется.
create function public.fill_team_message()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  select coalesce(nullif(full_name, ''), email, '') into new.author_name
  from public.profiles where id = new.author_id;
  new.body = trim(new.body);
  return new;
end;
$$;

create trigger team_messages_fill
  before insert on public.team_messages
  for each row execute function public.fill_team_message();

create function public.on_team_message_created()
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
    where role in ('manager', 'designer', 'videographer', 'copywriter', 'smm') and id <> new.author_id;
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
      'preview', left(new.body, 200)
    )
  );
  return new;
end;
$$;

create trigger team_messages_notify
  after insert on public.team_messages
  for each row execute function public.on_team_message_created();

-- RLS
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.team_messages enable row level security;

-- Создаются только через open_direct_conversation.
create policy "conversations: read"
  on public.conversations for select
  using (public.can_access_conversation(id));

create policy "conversation_members: read own"
  on public.conversation_members for select
  using (user_id = auth.uid());

create policy "team_messages: read"
  on public.team_messages for select
  using (public.can_access_conversation(conversation_id));

create policy "team_messages: write"
  on public.team_messages for insert
  with check (author_id = auth.uid() and public.can_access_conversation(conversation_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.team_messages;
  end if;
end;
$$;
