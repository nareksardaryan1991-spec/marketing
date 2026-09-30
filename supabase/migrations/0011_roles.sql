-- Новые роли. Отдельной миграцией: новое значение enum нельзя использовать
-- в той же транзакции, где оно добавлено.

-- Владелец компании: единственный, кто назначает роли.
alter type public.user_role add value if not exists 'admin';
-- Зарегистрировался как сотрудник и ждёт, пока администратор назначит роль.
alter type public.user_role add value if not exists 'pending';
alter type public.user_role add value if not exists 'video_editor';
alter type public.user_role add value if not exists 'photographer';
alter type public.user_role add value if not exists 'targetologist';
alter type public.user_role add value if not exists 'seo';
