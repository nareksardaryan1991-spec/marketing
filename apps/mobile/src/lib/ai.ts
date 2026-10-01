import { invokeFunction } from './functions';
import type { Language } from './types';

export type DraftKind = 'caption' | 'ideas' | 'reel_script' | 'content_plan';

export async function generateDraft(opts: {
  taskId: string;
  kind: DraftKind;
  language: Language;
  instructions: string;
}): Promise<string> {
  const result = await invokeFunction<{ text: string }>('ai-draft', {
    task_id: opts.taskId,
    kind: opts.kind,
    language: opts.language,
    instructions: opts.instructions,
  });
  return result.text;
}

// Помощник сотрудника: план дня по своим задачам или разбор одной задачи.
export async function askAssistant(opts: {
  mode: 'my_day' | 'task';
  language: Language;
  taskId?: string;
  question?: string;
}): Promise<string> {
  const result = await invokeFunction<{ text: string }>('ai-assistant', {
    mode: opts.mode,
    language: opts.language,
    task_id: opts.taskId,
    question: opts.question,
  });
  return result.text;
}
