// schema.ts — Ollama API schemas and types defined with Zod

import { z } from 'zod';

// ── OllamaMessage ─────────────────────────────────────────────────────────────

export const OllamaMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1, 'Message content must not be empty'),
});

export type OllamaMessage = z.infer<typeof OllamaMessageSchema>;

// ── OllamaChatRequest ─────────────────────────────────────────────────────────

export const OllamaModelOptionsSchema = z
  .object({
    /** Sampling temperature: 0.0 (deterministic) – 2.0 (very random). */
    temperature: z.number().min(0).max(2).optional(),
    /** Top-p nucleus sampling threshold: 0.0 – 1.0. */
    top_p: z.number().min(0).max(1).optional(),
    /** Top-k candidate token count, must be a positive integer. */
    top_k: z.number().int().positive().optional(),
    /** Context window size in tokens, must be a positive integer. */
    num_ctx: z.number().int().positive().optional(),
    /** Random seed for reproducible outputs. */
    seed: z.number().int().optional(),
  })
  .catchall(z.unknown());

export type OllamaModelOptions = z.infer<typeof OllamaModelOptionsSchema>;

export const OllamaChatRequestSchema = z.object({
  model: z.string().min(1, 'Model name must not be empty'),
  messages: z.array(OllamaMessageSchema).min(1, 'At least one message is required'),
  /** Set to "json" to force a valid JSON object response. */
  format: z.literal('json').optional(),
  stream: z.boolean().optional(),
  options: OllamaModelOptionsSchema.optional(),
});

export type OllamaChatRequest = z.infer<typeof OllamaChatRequestSchema>;

// ── OllamaChatResponse ────────────────────────────────────────────────────────

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

export type OllamaChatResponse = z.infer<typeof OllamaChatResponseSchema>;

// ── OllamaJsonPayload ─────────────────────────────────────────────────────────

/**
 * The parsed inner payload the model returns when format="json".
 * Either a tool call ({ tool, args }) or a conversational reply ({ response }).
 */
export const OllamaJsonPayloadSchema = z
  .object({
    /** Free-form text reply for conversational answers. */
    response: z.string().optional(),
    /** Error message surfaced by the model itself. */
    error: z.string().optional(),
    /** Tool name to invoke (tool-call path). */
    tool: z.string().optional(),
    /** Arguments for the tool (tool-call path). */
    args: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (v) => v.response !== undefined || v.error !== undefined || v.tool !== undefined,
    { message: 'JSON payload must contain at least one of: response, error, tool' },
  );

export type OllamaJsonPayload = z.infer<typeof OllamaJsonPayloadSchema>;

// ── ToolCall ──────────────────────────────────────────────────────────────────

/** Named tools the engine can execute. */
export const TOOL_NAMES = [
  'listFiles',
  'findFile',
  'deleteFile',
  'moveFile',
  'openApplication',
  'createDirectory',
  'organiseByRule',
  'screenAutomation',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Generic args bag — each tool validates its own required keys at runtime. */
export type ToolArgs = Record<string, unknown>;

export const ToolCallSchema = z.object({
  tool: z.enum(TOOL_NAMES, {
    message: `tool must be one of: ${TOOL_NAMES.join(', ')}`,
  }),
  args: z.record(z.string(), z.unknown()).default({}),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;
