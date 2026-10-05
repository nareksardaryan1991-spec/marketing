-- Пять AI-агентов вместо семи: копирайтер объединён с SMM (Ани), видео и фотограф — со
-- сценаристом (Арам). Старые запуски и версии не удаляются: они переходят к агенту, в которого
-- объединили прежнего, — их история видна в его чате и в задачах.

alter table public.agent_runs drop constraint agent_runs_agent_check;

update public.agent_runs set agent = 'smm' where agent = 'copywriter';
update public.agent_runs set agent = 'scriptwriter' where agent in ('video', 'photographer');
update public.deliverables set agent = 'smm' where agent = 'copywriter';
update public.deliverables set agent = 'scriptwriter' where agent in ('video', 'photographer');

alter table public.agent_runs add constraint agent_runs_agent_check
  check (agent in ('smm', 'designer', 'scriptwriter', 'targetologist', 'seo', 'manager'));
