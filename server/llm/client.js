// server/llm/client.js — Hybrid LLM adapter (Groq primary + Ollama local fallback)
import { OllamaJsonPayloadSchema } from './schema.js';
import { ollamaClient as groqClient, parseJsonPayload } from './ollama.js';
import OpenAI from 'openai';

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const OLLAMA_MODEL = 'qwen2.5';
const OLLAMA_HOST = 'http://127.0.0.1:11434';

let availabilityCache = null;

function localSystemPrompt() {
  return [
    'You are Fella. Reply with exactly one JSON object only.',
    'Allowed shapes:',
    '{"tool":"<toolName>","args":{...}}',
    '{"response":"<text>"}',
    '{"error":"<text>"}',
    'Never add markdown or prose outside JSON.',
  ].join(' ');
}

async function isOllamaAvailable() {
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

    const data = await response.json();
    const hasQwen = data.models?.some((m) => m.name.startsWith('qwen2.5'));

    if (!hasQwen) {
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

async function chatWithOllama(messages) {
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

  const data = await response.json();
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
  async chat(messages) {
    let lastGroqError = null;

    try {
      return await groqClient.chat(messages);
    } catch (groqErr) {
      lastGroqError = groqErr;
      console.error(
        `[LLMClient] Groq (${GROQ_MODEL}) failed, trying Ollama fallback (${OLLAMA_MODEL}): ${groqErr instanceof Error ? groqErr.message : String(groqErr)}`,
      );
    }

    if (await isOllamaAvailable()) {
      try {
        return await chatWithOllama(messages);
      } catch (ollamaErr) {
        console.error(
          `[LLMClient] Ollama fallback failed (${OLLAMA_MODEL}): ${ollamaErr instanceof Error ? ollamaErr.message : String(ollamaErr)}`,
        );
      }
    }

    return {
      response:
        `I couldn't reach the language model backend right now. ` +
        `Groq (${GROQ_MODEL}) failed${lastGroqError ? `: ${lastGroqError instanceof Error ? lastGroqError.message : String(lastGroqError)}` : ''}. ` +
        `Ollama (${OLLAMA_MODEL}) fallback is unavailable or failed. ` +
        `Please check GROQ_API_KEY in .env, or run "ollama pull ${OLLAMA_MODEL}" for local fallback.`,
    };
  }

  async generateText(prompt) {
    const key = process.env['GROQ_API_KEY'] ?? '';
    if (key) {
      try {
        const client = new OpenAI({
          apiKey: key,
          baseURL: 'https://api.groq.com/openai/v1',
        });
        const resp = await client.chat.completions.create({
          model: GROQ_MODEL,
          messages: [
            {
              role: 'system',
              content:
                'You are a helpful writing assistant. Write clear, polished prose. ' +
                'Return plain text only — no markdown, no JSON, no bullet points ' +
                'unless the topic clearly calls for a list.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 1024,
        });
        const text = resp.choices[0]?.message?.content?.trim() ?? '';
        if (text) return text;
      } catch (err) {
        console.error(
          `[LLMClient] Groq plain-text generation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (await isOllamaAvailable()) {
      try {
        const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            stream: false,
            messages: [
              { role: 'system', content: 'You are a helpful writing assistant. Return plain text only.' },
              { role: 'user', content: prompt },
            ],
            options: { temperature: 0.7 },
          }),
          signal: AbortSignal.timeout(25000),
        });
        if (response.ok) {
          const data = await response.json();
          const text = data.message?.content?.trim() ?? '';
          if (text) return text;
        }
      } catch (err) {
        console.error(
          `[LLMClient] Ollama plain-text generation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return '';
  }
}
