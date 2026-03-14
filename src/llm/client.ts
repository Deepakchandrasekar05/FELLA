import type { OllamaJsonPayload, OllamaMessage } from './schema.js';
import { ollamaClient } from './ollama.js';

/** Thin adapter used by the agent loop. */
export class LLMClient {
  async chat(messages: Array<{ role: string; content: string }>): Promise<OllamaJsonPayload> {
    const typed = messages as OllamaMessage[];
    return ollamaClient.chat(typed);
  }
}
