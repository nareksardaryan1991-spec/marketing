-- Групповые чаты команды: новый вид беседы. Отдельной миграцией: новое значение enum нельзя
-- использовать в той же транзакции, где оно добавлено.
alter type public.conversation_kind add value if not exists 'group';
