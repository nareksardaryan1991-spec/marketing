-- «Проверено человеком»: кто из менеджеров одобрил версию перед отправкой клиенту.
-- Имя сохраняем вместе с версией: клиент не видит профили команды, а значок должен
-- показывать того, кто проверял, даже если человек потом сменит имя или уйдёт.

alter table public.deliverables
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column reviewer_name text;

create or replace function public.review_task(p_task_id uuid, p_approve boolean, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
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
       set sent_to_client_at = now(),
           reviewed_by = auth.uid(),
           reviewer_name = (select coalesce(nullif(trim(full_name), ''), email) from public.profiles where id = auth.uid())
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
