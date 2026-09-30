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
