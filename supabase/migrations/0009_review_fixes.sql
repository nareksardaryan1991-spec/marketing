-- Исправления по итогам проверки кода.

-- 1. Клиент видит только версии, которые менеджер отправил ему на согласование.
--    Раньше клиент мог прочитать через API и внутренние черновики, и их файлы.

alter table public.deliverables add column sent_to_client_at timestamptz;

-- Уже отправленные клиенту: версии, по которым клиент принимал решение,
-- и последняя версия задач, дошедших до клиента.
update public.deliverables d
   set sent_to_client_at = d.created_at
 where exists (select 1 from public.approvals a where a.deliverable_id = d.id)
    or (
      d.version = (select max(version) from public.deliverables where task_id = d.task_id)
      and exists (
        select 1 from public.tasks t
        where t.id = d.task_id
          and t.status in ('client_review', 'changes_requested', 'approved', 'publishing', 'published')
      )
    );

create or replace function public.review_task(p_task_id uuid, p_approve boolean, p_comment text default null)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'only managers can review tasks';
  end if;

  update public.tasks
     set status = case when p_approve then 'client_review' else 'in_progress' end::public.task_status
   where id = p_task_id and status = 'internal_review';
  if not found then
    raise exception 'task is not waiting for review';
  end if;

  if p_approve then
    update public.deliverables
       set sent_to_client_at = now()
     where id = (
       select id from public.deliverables where task_id = p_task_id order by version desc limit 1
     );
  end if;

  if nullif(trim(p_comment), '') is not null then
    insert into public.task_comments (task_id, author_id, body)
    values (p_task_id, auth.uid(), trim(p_comment));
  end if;
end;
$$;

drop policy "deliverables: read" on public.deliverables;

create policy "deliverables: read"
  on public.deliverables for select
  using (
    public.can_work_on_task(task_id)
    or (
      sent_to_client_at is not null
      and exists (
        select 1 from public.tasks t
        join public.orders o on o.id = t.order_id
        where t.id = task_id and o.client_id = auth.uid()
      )
    )
  );

-- Файл доступен клиенту, только если он входит в отправленную ему версию.
create function public.client_can_read_file(p_name text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.deliverables d
    join public.tasks t on t.id = d.task_id
    join public.orders o on o.id = t.order_id
    where d.task_id = public.task_id_from_path(p_name)
      and d.sent_to_client_at is not null
      and p_name = any (d.files)
      and o.client_id = auth.uid()
  );
$$;

drop policy "deliverables files: read" on storage.objects;

create policy "deliverables files: read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'deliverables'
    and (
      public.can_work_on_task(public.task_id_from_path(name))
      or public.client_can_read_file(name)
    )
  );

-- 2. Исполнитель (в том числе фрилансер) видит состав заказа своей задачи —
--    AI-помощник учитывает его при написании черновика.
drop policy "order_items: read with order" on public.order_items;

create policy "order_items: read with order"
  on public.order_items for select
  using (
    public.is_assignee_of_order(order_id)
    or exists (
      select 1 from public.orders o
      where o.id = order_id and (o.client_id = auth.uid() or public.is_team())
    )
  );
