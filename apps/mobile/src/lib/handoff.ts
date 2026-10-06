import { agentById, type Agent, type ChatResult } from './agents';
import { fileName } from './files';
import { supabase } from './supabase';

// «Передать человеку»: черновик AI-агента становится заданием для сотрудника.
// Работа агента бывает двух видов:
//   * в задаче по заказу — версия материала (deliverables: текст и файлы в bucket deliverables);
//   * в чате с агентом — ответ (result: текст, подпись, картинки в bucket agent-files).
export type AgentDraft = {
  runId: string;
  agent: Agent | null;
  instructions: string | null;
  text: string;
  files: string[];
  bucket: 'deliverables' | 'agent-files';
  // Клиент и заказ исходной задачи — новая задача про то же.
  businessId: string | null;
  orderId: string | null;
};

type RunRow = {
  id: string;
  agent: string;
  instructions: string | null;
  result: ChatResult | null;
  deliverables: { caption: string | null; files: string[] } | null;
  tasks: {
    kind: string;
    business_id: string | null;
    order_id: string | null;
    related_order_id: string | null;
  } | null;
};

export async function loadAgentDraft(runId: string): Promise<AgentDraft> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select(
      'id, agent, instructions, result, deliverables(caption, files), ' +
        'tasks!agent_runs_task_id_fkey(kind, business_id, order_id, related_order_id)',
    )
    .eq('id', runId)
    .single<RunRow>();
  if (error) throw error;
  const version = data.deliverables;
  const result = data.result;
  return {
    runId: data.id,
    agent: agentById(data.agent),
    instructions: data.instructions,
    text: (version ? [version.caption] : [result?.text, result?.caption]).filter(Boolean).join('\n\n'),
    files: version?.files ?? result?.files ?? [],
    bucket: version ? 'deliverables' : 'agent-files',
    businessId: data.tasks?.business_id ?? null,
    orderId: data.tasks?.order_id ?? data.tasks?.related_order_id ?? null,
  };
}

// Файлы черновика — копии в папке новой задачи (копирует сервер хранилища, без скачивания).
export async function copyDraftFiles(draft: AgentDraft, taskId: string): Promise<string[]> {
  const copied: string[] = [];
  for (const [i, path] of draft.files.entries()) {
    // Префикс «<время><номер>-» fileName() потом отбрасывает — в задаче видно исходное имя.
    const target = `${taskId}/${Date.now()}${i}-${fileName(path).replace(/[^\w.\-]+/g, '_')}`;
    const { error } = await supabase.storage
      .from(draft.bucket)
      .copy(path, target, { destinationBucket: 'deliverables' });
    if (error) throw error;
    copied.push(target);
  }
  return copied;
}
