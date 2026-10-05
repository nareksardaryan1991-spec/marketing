import { invokeFunction } from './functions';
import { supabase } from './supabase';
import type { Language } from './types';

// Те же агенты, что в supabase/functions/ai-agent/agents.ts.
export type AgentId = 'smm' | 'designer' | 'scriptwriter' | 'targetologist' | 'seo' | 'manager';

export type Agent = {
  id: AgentId;
  // Цвет агента: фон аватара и акценты.
  color: string;
  // Аватар. Временный — SVG со значком роли; финальную иллюстрацию положить в assets/agents/
  // (например, smm.png) и заменить здесь require — больше ничего менять не нужно.
  avatar: number;
  // Для каких услуг агент подходит (null — для любых). Менеджер работает с заказом.
  services: string[] | null;
};

export const AGENTS: Agent[] = [
  { id: 'smm', color: '#E5484D', avatar: require('../../assets/agents/smm.svg'), services: null },
  { id: 'designer', color: '#C026D3', avatar: require('../../assets/agents/designer.svg'), services: ['post', 'story'] },
  {
    id: 'scriptwriter',
    color: '#D97706',
    avatar: require('../../assets/agents/scriptwriter.svg'),
    services: ['reel', 'video_shoot', 'post', 'story'],
  },
  {
    id: 'targetologist',
    color: '#059669',
    avatar: require('../../assets/agents/targetologist.svg'),
    services: ['ads_management', 'post', 'story', 'reel'],
  },
  { id: 'seo', color: '#0284C7', avatar: require('../../assets/agents/seo.svg'), services: null },
  { id: 'manager', color: '#4F46E5', avatar: require('../../assets/agents/manager.svg'), services: null },
];

// Агенты, которых объединили (миграция 0021 переписала их записи, но в старых данных
// и в демо они ещё могут встретиться): копирайтер → SMM, видео и фотограф → сценарист.
const MERGED: Record<string, AgentId> = { copywriter: 'smm', video: 'scriptwriter', photographer: 'scriptwriter' };

export function isAgentId(value: unknown): value is AgentId {
  return AGENTS.some((a) => a.id === value);
}

// Агент по id из базы, с учётом объединённых; null — если такого нет.
export function agentById(id: string | null | undefined): Agent | null {
  if (!id) return null;
  const target = MERGED[id] ?? id;
  return AGENTS.find((a) => a.id === target) ?? null;
}

export function agentsForService(serviceId: string) {
  return AGENTS.filter((a) => a.id !== 'manager' && (!a.services || a.services.includes(serviceId)));
}

// Задачи, которые можно поручить агенту (так же проверяет сервер).
export const AGENT_TASK_STATUSES = ['new', 'assigned', 'in_progress', 'changes_requested'] as const;

export type ManagerPlan = {
  summary: string;
  tasks: { task_id: string; brief: string; assignee_id: string; due_date: string; reason: string }[];
};

// Ответ агента в чате.
export type ChatResult = { text: string; caption: string | null; files: string[]; needs_image_key?: boolean };

export type AgentRun = {
  id: string;
  task_id: string | null;
  order_id: string | null;
  agent: AgentId;
  status: 'running' | 'done' | 'failed' | 'applied';
  chat: boolean;
  instructions: string | null;
  deliverable_id: string | null;
  result: ManagerPlan | ChatResult | { backgrounds?: 'generated' | 'gradient' } | null;
  error: string | null;
  images: number;
  created_at: string;
};

export async function startAgent(opts: {
  agent: AgentId;
  taskId?: string;
  orderId?: string;
  instructions: string;
  language?: Language;
}): Promise<string> {
  const result = await invokeFunction<{ run_id: string }>('ai-agent', {
    agent: opts.agent,
    task_id: opts.taskId,
    order_id: opts.orderId,
    instructions: opts.instructions,
    language: opts.language,
  });
  return result.run_id;
}

export async function applyManagerPlan(runId: string): Promise<number> {
  const { data, error } = await supabase.rpc('apply_manager_plan', { p_run_id: runId });
  if (error) throw error;
  return data as number;
}

// Чат с агентом: написали «сделай…» — агент сразу делает, ответ появится в agent_runs.
export async function askAgent(agent: AgentId, prompt: string): Promise<string> {
  const result = await invokeFunction<{ run_id: string }>('ai-agent', { mode: 'request', agent, prompt });
  return result.run_id;
}

// Результат из чата → версия задачи на проверке у менеджера.
export async function attachRun(runId: string, taskId: string): Promise<void> {
  await invokeFunction('ai-agent', { mode: 'attach', run_id: runId, task_id: taskId });
}
