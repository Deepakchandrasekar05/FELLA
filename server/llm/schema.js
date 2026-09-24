// server/llm/schema.js — Ollama/Groq API schemas defined with Zod
import { z } from 'zod';

export const OllamaMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1, 'Message content must not be empty'),
});

export const OllamaModelOptionsSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    top_k: z.number().int().positive().optional(),
    num_ctx: z.number().int().positive().optional(),
    seed: z.number().int().optional(),
  })
  .catchall(z.unknown());

export const OllamaChatRequestSchema = z.object({
  model: z.string().min(1, 'Model name must not be empty'),
  messages: z.array(OllamaMessageSchema).min(1, 'At least one message is required'),
  format: z.literal('json').optional(),
  stream: z.boolean().optional(),
  options: OllamaModelOptionsSchema.optional(),
});

export const OllamaChatResponseSchema = z.object({
  model: z.string().min(1),
  created_at: z.string().min(1),
  message: OllamaMessageSchema,
  done: z.boolean(),
  done_reason: z.string().optional(),
  total_duration: z.number().nonnegative().optional(),
  load_duration: z.number().nonnegative().optional(),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  prompt_eval_duration: z.number().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
  eval_duration: z.number().nonnegative().optional(),
});

export const OllamaJsonPayloadSchema = z
  .object({
    response: z.string().optional(),
    error: z.string().optional(),
    tool: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (v) => v.response !== undefined || v.error !== undefined || v.tool !== undefined,
    { message: 'JSON payload must contain at least one of: response, error, tool' },
  );

export const TOOL_NAMES = [
  'listFiles',
  'findFile',
  'deleteFile',
  'moveFile',
  'createFile',
  'writeFile',
  'readFile',
  'renameFile',
  'openApplication',
  'createDirectory',
  'organiseByRule',
  'openSettings',
  'screenAutomation',
  'browserAutomation',
];

export const ToolCallSchema = z.object({
  tool: z.enum(TOOL_NAMES, {
    message: `tool must be one of: ${TOOL_NAMES.join(', ')}`,
  }),
  args: z.record(z.string(), z.unknown()).default({}),
});
