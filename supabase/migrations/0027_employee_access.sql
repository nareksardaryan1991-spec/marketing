-- Роль «Сотрудник» (employee): права и должность.
--
-- Сотрудник, как фрилансер, не входит в штатную команду (is_team): видит только свои задачи,
-- бизнесы клиентов этих задач и личные чаты. В отличие от фрилансера, ему не видны заказы —
-- в них суммы и цены. Пожелания клиента к заказу он получает через task_order_notes.

-- Должность — подпись к роли («Дизайнер», «Фотограф»). Меняет только владелец (set_job_title):
-- права на обновление этого столбца у пользователей нет.
alter table public.profiles
  add column job_title text check (length(job_title) <= 60);

create or replace function public.is_team_role(p_role public.user_role)
returns boolean
language sql
immutable
as $$
  select p_role not in ('client', 'pending', 'freelancer', 'employee');
$$;

-- Заказ (и его позиции) по своей задаче видит фрилансер, но не сотрудник.
create or replace function public.is_assignee_of_order(p_order_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select public.my_role() is distinct from 'employee'
    and exists (
      select 1 from public.tasks where order_id = p_order_id and assignee_id = auth.uid()
    );
$$;

-- Пожелания клиента к заказу — для экрана задачи, без доступа к самому заказу.
create function public.task_order_notes(p_task_id uuid)
returns text
language sql
stable
security definer set search_path = ''
as $$
  select o.notes
  from public.tasks t
  join public.orders o on o.id = t.order_id
  where t.id = p_task_id and public.can_view_task(p_task_id);
$$;

create function public.set_job_title(target_user uuid, new_title text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'only the administrator can change job titles';
  end if;
  update public.profiles
     set job_title = nullif(trim(new_title), '')
   where id = target_user and public.is_employee_role(role);
  if not found then
    raise exception 'user not found';
  end if;
end;
$$;

revoke execute on function public.task_order_notes, public.set_job_title from public, anon;
grant execute on function public.task_order_notes, public.set_job_title to authenticated;
