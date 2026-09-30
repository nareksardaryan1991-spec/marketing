-- Демо-данные для ЛОКАЛЬНОГО запуска (scripts/local.sh). В облако не попадают:
-- `supabase db push` применяет только миграции.
--
-- Аккаунты (пароль у всех demo1234):
--   admin@demo.am       — владелец компании (назначает роли)
--   manager@demo.am     — менеджер
--   designer@demo.am    — дизайнер
--   freelancer@demo.am  — фрилансер
--   client@demo.am      — клиент, кофейня Cafe Aroma
--   newbie@demo.am      — новый сотрудник, ждёт роли от владельца

-- ---------- Пользователи ----------
create function pg_temp.demo_user(p_id uuid, p_email text, p_name text)
returns void
language plpgsql
as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('demo1234', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}',
    jsonb_build_object('full_name', p_name, 'language', 'ru'),
    now() - interval '40 days', now(), '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), p_id, p_id::text,
    jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
    'email', now(), now(), now()
  );
end;
$$;

select pg_temp.demo_user('11111111-0000-4000-8000-000000000001', 'manager@demo.am', 'Нарек');
select pg_temp.demo_user('11111111-0000-4000-8000-000000000002', 'designer@demo.am', 'Ани Саргсян');
select pg_temp.demo_user('11111111-0000-4000-8000-000000000003', 'freelancer@demo.am', 'Давид Акопян');
select pg_temp.demo_user('11111111-0000-4000-8000-000000000004', 'client@demo.am', 'Анна Петросян');
select pg_temp.demo_user('11111111-0000-4000-8000-000000000005', 'admin@demo.am', 'Арам Владелец');
select pg_temp.demo_user('11111111-0000-4000-8000-000000000006', 'newbie@demo.am', 'Лусине Мартиросян');

update public.profiles set role = 'manager' where email = 'manager@demo.am';
update public.profiles set role = 'designer' where email = 'designer@demo.am';
update public.profiles set role = 'freelancer' where email = 'freelancer@demo.am';
update public.profiles set role = 'admin' where email = 'admin@demo.am';
update public.profiles set role = 'pending' where email = 'newbie@demo.am';

-- ---------- Бизнес клиента ----------
insert into public.businesses (
  id, owner_id, name, industry, city, description, target_audience, tone, goals, competitors, instagram_url
) values (
  '22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000004',
  'Cafe Aroma', 'Кофейня', 'Ереван', 'Кофейня в центре: авторский кофе и десерты',
  'Студенты и офисные сотрудники 20–35 лет', 'Дружелюбный, с юмором',
  'Больше гостей по утрам, рост подписчиков', 'Coffeeshop Company',
  'https://instagram.com/cafe_aroma'
);

-- ---------- Оплаченный ежемесячный заказ ----------
insert into public.orders (id, business_id, client_id, billing, publishing, items_total_amd, total_amd, notes, created_at)
values (
  '33333333-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001',
  '11111111-0000-4000-8000-000000000004', 'monthly', 'team', 63000, 63000,
  'Осеннее меню, акцент на тыквенный латте', now() - interval '10 days'
);

insert into public.order_items (order_id, service_id, platform_id, quantity, unit_price_amd, line_total_amd) values
  ('33333333-0000-4000-8000-000000000001', 'post', 'instagram', 3, 8000, 24000),
  ('33333333-0000-4000-8000-000000000001', 'story', 'instagram', 2, 4000, 8000),
  ('33333333-0000-4000-8000-000000000001', 'post', 'facebook', 1, 6000, 6000),
  ('33333333-0000-4000-8000-000000000001', 'reel', 'tiktok', 1, 25000, 25000);

insert into public.payments (id, order_id, provider, amount_amd)
values ('44444444-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000001', 'test', 63000);

-- Как настоящая оплата: заказ → «Оплачен», создаются 7 задач (по площадкам).
select public.mark_payment_succeeded('44444444-0000-4000-8000-000000000001', 'demo', '{"demo": true}');

-- ---------- Задачи в разных состояниях ----------
create function pg_temp.task_id(p_platform text, p_service text, p_number int)
returns uuid
language sql
as $$
  select id from public.tasks
  where order_id = '33333333-0000-4000-8000-000000000001'
    and platform_id = p_platform and service_id = p_service and number = p_number;
$$;

create function pg_temp.deliver(p_task uuid, p_caption text, p_sent boolean)
returns void
language sql
as $$
  insert into public.deliverables (task_id, version, caption, created_by, sent_to_client_at)
  values (p_task, 1, p_caption, '11111111-0000-4000-8000-000000000002', case when p_sent then now() - interval '1 day' end);
$$;

-- Пост №1 — опубликован
update public.tasks set assignee_id = '11111111-0000-4000-8000-000000000002', status = 'published',
  publish_at = now() - interval '5 days', published_at = now() - interval '5 days',
  published_url = 'https://instagram.com/p/demo-aroma-1'
where id = pg_temp.task_id('instagram', 'post', 1);
select pg_temp.deliver(pg_temp.task_id('instagram', 'post', 1),
  'Доброе утро начинается с Cafe Aroma ☕ Заходите на Абовяна 12 — первые 10 гостей получат круассан в подарок!', true);

-- Пост №2 — ждёт согласования клиента
update public.tasks set assignee_id = '11111111-0000-4000-8000-000000000002', status = 'client_review',
  publish_at = now() + interval '2 days', due_date = current_date + 1,
  brief = 'Тыквенный латте: уютная осенняя подача, цена 1 800 ֏'
where id = pg_temp.task_id('instagram', 'post', 2);
select pg_temp.deliver(pg_temp.task_id('instagram', 'post', 2),
  E'Осень пришла — и тыквенный латте вернулся! 🎃☕\nНежная пряная пенка, корица и немного магии. Всего 1 800 ֏.\nЖдём вас на Абовяна 12 🍪\n\n#CafeAroma #Ереван #кофе #осень', true);

-- Пост №3 — на внутренней проверке у менеджера
update public.tasks set assignee_id = '11111111-0000-4000-8000-000000000002', status = 'internal_review',
  due_date = current_date + 2, brief = 'Новый десерт: чизкейк с солёной карамелью'
where id = pg_temp.task_id('instagram', 'post', 3);
select pg_temp.deliver(pg_temp.task_id('instagram', 'post', 3),
  'Солёная карамель + нежный чизкейк = идеальная пара к вашему капучино 🍰', false);

-- Facebook, пост №1 — в работе у дизайнера
update public.tasks set assignee_id = '11111111-0000-4000-8000-000000000002', status = 'in_progress',
  due_date = current_date + 4, brief = 'Утренний кофе с собой: скидка 10% до 10:00'
where id = pg_temp.task_id('facebook', 'post', 1);

-- TikTok, видео №1 — назначено фрилансеру
update public.tasks set assignee_id = '11111111-0000-4000-8000-000000000003', status = 'assigned',
  due_date = current_date + 5, brief = 'Процесс приготовления латте-арта, 15–20 секунд'
where id = pg_temp.task_id('tiktok', 'reel', 1);

-- История №1 — одобрена, публикация завтра
update public.tasks set assignee_id = '11111111-0000-4000-8000-000000000002', status = 'approved',
  publish_at = date_trunc('day', now()) + interval '1 day 10 hours'
where id = pg_temp.task_id('instagram', 'story', 1);
select pg_temp.deliver(pg_temp.task_id('instagram', 'story', 1), 'Опрос: тыквенный латте или раф с карамелью? 🗳', true);

-- История №2 остаётся новой, без исполнителя.

update public.orders set status = 'in_progress' where id = '33333333-0000-4000-8000-000000000001';

-- ---------- Чат и комментарии ----------
insert into public.messages (order_id, author_id, body, created_at) values
  ('33333333-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000004',
   'Здравствуйте! Можно в осенних постах сделать акцент на тыквенный латте?', now() - interval '3 days'),
  ('33333333-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
   'Конечно! Пост уже готов и ждёт вашего согласования в заказе 🙂', now() - interval '1 day');

insert into public.task_comments (task_id, author_id, body) values
  (pg_temp.task_id('instagram', 'post', 2), '11111111-0000-4000-8000-000000000001', 'Отлично, отправляю клиенту.');

-- ---------- Чат команды ----------
insert into public.team_messages (conversation_id, author_id, body, created_at) values
  ('00000000-0000-4000-8000-00000000c0de', '11111111-0000-4000-8000-000000000001',
   'Всем доброе утро! Сегодня в 11:00 короткая планёрка по Cafe Aroma.', now() - interval '5 hours'),
  ('00000000-0000-4000-8000-00000000c0de', '11111111-0000-4000-8000-000000000002',
   'Буду. Пост №3 уже на проверке 👍', now() - interval '4 hours');

insert into public.conversations (id, kind, direct_key) values (
  '55555555-0000-4000-8000-000000000001', 'direct',
  '11111111-0000-4000-8000-000000000001:11111111-0000-4000-8000-000000000002'
);
insert into public.conversation_members (conversation_id, user_id) values
  ('55555555-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001'),
  ('55555555-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000002');
insert into public.team_messages (conversation_id, author_id, body, created_at) values
  ('55555555-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
   'Ани, для поста №4 возьми фото с новой витрины.', now() - interval '2 hours'),
  ('55555555-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000002',
   'Хорошо, сделаю до вечера.', now() - interval '1 hour');

-- Демо-уведомления не нужны — очищаем очередь, созданную триггерами выше.
delete from public.notifications;

-- ---------- Вызовы функций из базы (уведомления, автопубликация) ----------
-- Локально база обращается к функциям через внутренний адрес шлюза Supabase.
-- Секреты совпадают с supabase/functions/.env, который создаёт scripts/local.sh.
select vault.create_secret('http://supabase_kong_marketing:8000', 'project_url');
select vault.create_secret('local-notify-secret', 'notify_webhook_secret');
select vault.create_secret('local-cron-secret', 'autopublish_secret');
