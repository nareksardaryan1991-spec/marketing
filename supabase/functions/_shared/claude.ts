import Anthropic from 'npm:@anthropic-ai/sdk';

import { json, requireEnv } from './http.ts';

const MODEL = 'claude-opus-5-5';

export type ClaudeResult =
  | { ok: true; text: string; model: string; inputTokens: number; outputTokens: number; truncated: boolean }
  | { ok: false; response: Response };

// Один запрос к Claude. Ошибки превращаются в готовый HTTP-ответ для клиента.
// С schema ответ — JSON строго по этой схеме (structured outputs).
export async function askClaude(
  system: string,
  userPrompt: string,
  schema?: Record<string, unknown>,
): Promise<ClaudeResult> {
  const client = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: {
        effort: 'medium',
        ...(schema ? { format: { type: 'json_schema' as const, schema } } : {}),
      },
      // При отказе модели запрос автоматически повторяется на рекомендованной резервной модели.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, response: json({ error: 'AI is busy, try again in a minute' }, 429) };
    }
    if (error instanceof Anthropic.APIError) {
      console.error('Anthropic API error', error.status, error.message);
      return { ok: false, response: json({ error: 'AI request failed' }, 502) };
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') {
    return { ok: false, response: json({ error: 'AI declined this request' }, 422) };
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) return { ok: false, response: json({ error: 'AI returned no text' }, 502) };

  return {
    ok: true,
    text,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    truncated: response.stop_reason === 'max_tokens',
  };
}
