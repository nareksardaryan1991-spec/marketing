import { invokeFunction } from './functions';
import { supabase } from './supabase';
import type { Language } from './types';

// Те же агенты, что в supabase/functions/ai-agent/agents.ts.
export type AgentId =
  | 'copywriter'
  | 'designer'
  | 'smm'
  | 'video'
  | 'photographer'
  | 'targetologist'
  | 'seo'
  | 'manager';

// services — для каких услуг агент подходит (null — для любых). Менеджер работает с заказом.
export const AGENTS: { id: AgentId; icon: string; services: string[] | null }[] = [
  { id: 'copywriter', icon: '✍️', services: null },
  { id: 'designer', icon: '🎨', services: ['post', 'story'] },
  { id: 'smm', icon: '📅', services: null },
  { id: 'video', icon: '🎬', services: ['reel', 'video_shoot'] },
  { id: 'photographer', icon: '📷', services: ['post', 'story', 'video_shoot'] },
  { id: 'targetologist', icon: '🎯', services: ['ads_management', 'post', 'story', 'reel'] },
  { id: 'seo', icon: '🔎', services: null },
  { id: 'manager', icon: '🧭', services: null },
];

export function isAgentId(value: unknown): value is AgentId {
  return AGENTS.some((a) => a.id === value);
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
