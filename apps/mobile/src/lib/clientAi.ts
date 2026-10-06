import { invokeFunction } from './functions';
import { supabase } from './supabase';
import type { Language } from './types';

// Подарок после знакомства (welcome_kits) и идеи задач от агентов (task_ideas) — их готовит
// серверная функция client-ai в фоне; приложение запускает и опрашивает таблицы.

export type WelcomeKit = {
  business_id: string;
  status: 'running' | 'done' | 'failed';
  result: {
    posts: { title: string; caption: string; image_idea: string; best_time: string }[];
    plan: { day: Weekday; format: 'post' | 'story' | 'reel' | 'rest'; topic: string }[];
  } | null;
  created_at: string;
};

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type TaskIdea = {
  id: string;
  business_id: string;
  week_start: string;
  agent: string;
  title: string;
  description: string;
  service_id: string;
  platform_id: string | null;
  status: 'proposed' | 'accepted' | 'dismissed';
  order_id: string | null;
};

export async function startWelcome(language: Language): Promise<void> {
  await invokeFunction('client-ai', { mode: 'welcome', language });
}

export async function startIdeas(language: Language): Promise<void> {
  await invokeFunction('client-ai', { mode: 'ideas', language });
}

// «Принять» — создаётся заказ из одной позиции; возвращает его id.
export async function acceptIdea(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_task_idea', { p_idea_id: id });
  if (error) throw error;
  return data as string;
}

export async function dismissIdea(id: string): Promise<void> {
  const { error } = await supabase.rpc('dismiss_task_idea', { p_idea_id: id });
  if (error) throw error;
}

// Понедельник текущей недели по Еревану — так же считает сервер.
export function currentWeekStart(now = new Date()): string {
  const yerevan = new Date(now.getTime() + 4 * 3600_000);
  yerevan.setUTCDate(yerevan.getUTCDate() - ((yerevan.getUTCDay() + 6) % 7));
  return yerevan.toISOString().slice(0, 10);
}
