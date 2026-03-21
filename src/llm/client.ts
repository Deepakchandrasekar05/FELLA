import type { OllamaJsonPayload, OllamaMessage } from './schema.js';
import { OllamaJsonPayloadSchema } from './schema.js';
import { ollamaClient as groqClient } from './ollama.js';

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const OLLAMA_MODEL = 'qwen2.5';
const OLLAMA_HOST = 'http://127.0.0.1:11434';

type AvailabilityCache = {
  checkedAt: number;
  available: boolean;
};

let availabilityCache: AvailabilityCache | null = null;

function stripMarkdownJson(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function parseJsonPayload(content: string): OllamaJsonPayload {
  const cleaned = stripMarkdownJson(content);

  const tryParse = (raw: string): unknown | null => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  let parsed = tryParse(cleaned);
  if (parsed === null) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      parsed = tryParse(cleaned.slice(start, end + 1));
    }
  }

  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    'action' in (parsed as object) &&
    !('tool' in (parsed as object)) &&
    !('response' in (parsed as object))
  ) {
    const p = parsed as Record<string, unknown>;
    parsed = { tool: p['action'], args: p['args'] ?? {} };
  }

  const result = parsed !== null ? OllamaJsonPayloadSchema.safeParse(parsed) : null;
  if (result?.success) return result.data;

  return { response: content };
}

function localSystemPrompt(): string {
  return [
    'You are Fella. Reply with exactly one JSON object only.',
    'Allowed shapes:',
    '{"tool":"<toolName>","args":{...}}',
    '{"response":"<text>"}',
    '{"error":"<text>"}',
    'Never add markdown or prose outside JSON.',
  ].join(' ');
}

async function isOllamaAvailable(): Promise<boolean> {
  const now = Date.now();
  if (availabilityCache && now - availabilityCache.checkedAt < 15000) {
    return availabilityCache.available;
  }

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      availabilityCache = { checkedAt: now, available: false };
      return false;
    }

    const data = (await response.json()) as { models: Array<{ name: string }> };
    const hasQwen = data.models.some((m) => m.name.startsWith('qwen2.5'));

    if (!hasQwen) {
      console.error(
        '\n  ⚠ Ollama is running but qwen2.5 is not installed.\n' +
        '  Run: ollama pull qwen2.5\n',
      );
      availabilityCache = { checkedAt: now, available: false };
      return false;
    }

    availabilityCache = { checkedAt: now, available: true };
    return true;
  } catch {
    availabilityCache = { checkedAt: now, available: false };
    return false;
  }
}

async function chatWithOllama(messages: OllamaMessage[]): Promise<OllamaJsonPayload> {
  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: localSystemPrompt() },
        ...messages,
      ],
      options: {
        temperature: 0,
      },
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed [${response.status}]`);
  }

  const data = (await response.json()) as { message?: { content?: string } };
  const content = data.message?.content;
  if (!content) {
    throw new Error('Empty response from Ollama');
  }

  return parseJsonPayload(content);
}

/**
 * Hybrid LLM adapter:
 * 1) Use Groq (llama-3.3-70b-versatile) as primary.
 * 2) Fall back to local Ollama qwen2.5 when Groq fails.
 */
export class LLMClient {
  async chat(messages: Array<{ role: string; content: string }>): Promise<OllamaJsonPayload> {
    const typed = messages as OllamaMessage[];
    let lastGroqError: unknown = null;

    try {
      return await groqClient.chat(typed);
    } catch (groqErr) {
      lastGroqError = groqErr;
      console.error(
        `\n  ⚠ Groq (${GROQ_MODEL}) failed, trying Ollama fallback (${OLLAMA_MODEL}): ${groqErr instanceof Error ? groqErr.message : String(groqErr)}\n`,
      );
    }

    if (await isOllamaAvailable()) {
      try {
        return await chatWithOllama(typed);
      } catch (ollamaErr) {
        console.error(
          `\n  ⚠ Ollama fallback failed (${OLLAMA_MODEL}): ${ollamaErr instanceof Error ? ollamaErr.message : String(ollamaErr)}\n`,
        );
      }
    }

    return {
      response:
        `I couldn't reach the language model backend right now. ` +
        `Groq (${GROQ_MODEL}) failed${lastGroqError ? `: ${lastGroqError instanceof Error ? lastGroqError.message : String(lastGroqError)}` : ''}. ` +
        `Ollama (${OLLAMA_MODEL}) fallback is unavailable or failed. ` +
        `Please retry in a moment, or run \"ollama pull ${OLLAMA_MODEL}\" if you want local fallback ready.`,
    };
  }
}
