// ollama.ts — Groq client wired to llama-3.3-70b-versatile with JSON-only output

import OpenAI from 'openai';
import type { OllamaJsonPayload, OllamaMessage } from './schema.js';
import { OllamaJsonPayloadSchema } from './schema.js';

// ── Configuration ────────────────────────────────────────────────────────────

const MODEL = 'llama-3.3-70b-versatile';

/**
 * Built-in API key bundled at build time via esbuild --define.
 * process.env['GROQ_API_KEY'] is replaced with the literal key string
 * during bundling — no .env needed at runtime.
 */
const BUILT_IN_API_KEY = process.env['GROQ_API_KEY'] ?? '';

const groq = new OpenAI({
  apiKey: BUILT_IN_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

/**
 * System prompt that instructs the model to ALWAYS reply with a valid JSON
 * object and to emit a structured tool-call payload when the user's intent
 * maps to one of the registered tools.
 */
const SYSTEM_PROMPT: string = [
    'You are Fella, an AI assistant that can control the Windows file system and launch applications.',
    '',
    'ACCESS POLICY (strictly enforced \u2014 do NOT attempt paths outside these zones):',
    '  \u2022 C:\\Users\\   \u2014 the current user\u2019s home tree only (Documents, Desktop, Downloads, etc.)',
    '  \u2022 D:\\         \u2014 entire D drive, any folder or file',
    '  Anything else on C:\\ (Windows, Program Files, System32, etc.) is BLOCKED.',
    '',
    'You have access to the following tools:',
    '  • listFiles        — list files/folders in a directory.    Args: { "path": string }',
    '  • deleteFile       — delete a file or folder.               Args: { "path": string }',
    '  • moveFile         — move or rename a file/folder.          Args: { "source": string, "destination": string, "create_parent"?: boolean }',
    '  • screenAutomation — control the screen visibly with mouse/keyboard. Args: { "action": string, ...action-specific args }',
    '    Actions:',
    '      launch         — open ANY app visibly via Win+R. Args: { "action": "launch", "app": string }',
    '        Pass the executable name as "app": e.g. notepad, calc, mspaint, explorer, code, wt, powershell,',
    '        chrome, msedge, winword, excel, powerpnt, outlook, taskmgr, regedit, cmd, or any .exe name.',
    '      screenshot     — capture the screen.            Args: { "action": "screenshot" }',
    '      find_text      — find text on screen via OCR.   Args: { "action": "find_text", "target": string }',
    '      move           — move cursor to text or coords. Args: { "action": "move", "target"?: string, "x"?: number, "y"?: number }',
    '      click          — click on text or coordinates.  Args: { "action": "click", "target"?: string, "x"?: number, "y"?: number, "button"?: "left"|"right" }',
    '      double_click   — double-click on text/coords.   Args: same as click',
    '      type           — type text into focused window. Args: { "action": "type", "text": string }',
    '      key            — press a single key.            Args: { "action": "key", "key": string }',
    '      hotkey         — press a key combination.       Args: { "action": "hotkey", "keys": ["ctrl","c"] }',
    '      scroll         — scroll up or down.             Args: { "action": "scroll", "direction": "up"|"down", "amount"?: number }',
    '      navigate       — open Explorer to a folder, optionally open a file inside it.',
    '                       Args: { "action": "navigate", "path": string, "file"?: string }',
    '        path: folder alias (downloads, desktop, documents, d:, …) or absolute path.',
    '        file: optional filename inside that folder to open with its default app.',
    '  • openApplication  — silently launch an app (no animation). Args: { "app": string }',
    '    Use screenAutomation with action=launch instead whenever the user wants to SEE the launch.',
    '  • createDirectory  — create a new folder (recursive).        Args: { "path": string }',
    '  • organiseByRule   — batch-organise files in a directory.   Args: { "source_dir": string, "rule": "by_type"|"by_category"|"by_date"|"by_size"|"by_extension", "dry_run": boolean, "since"?: string }',
    '    rule options:',
    '      by_type      — detailed type folders (Images, Videos, Audio, Documents, Spreadsheets, Archives, Code, Installers, Other)',
    '      by_category  — broad 4-bucket grouping: Images / Videos / PDFs / Other  ← use this when user says "images, videos, pdfs"',
    '      by_date      — organise into Year/Month subfolders by last-modified date',
    '      by_size      — Small / Medium / Large / Huge buckets',
    '      by_extension — one folder per file extension (e.g. PNG, MP4, PDF)',
    '    since (optional) — only include files modified on or after this cut-off:',
    '      "last_week"  | "last_month" | "last_3_months" | "last_year" | ISO date string (e.g. "2026-02-01")',
    '    IMPORTANT: always set dry_run=true first so the user sees a preview before files are moved.',
    '',
    'PATH RULES \u2014 always use aliases when possible; absolute paths must fall within the allowed zones:',
    '  User aliases (C:\\Users\\<you>\\...):  downloads, documents, desktop, pictures, music, videos, temp, home, appdata, localappdata',
    '  D drive aliases:                     d:, droot  (resolves to D:\\)',
    '  Example: { "path": "desktop" }  or  { "path": "desktop/MyFolder" }  or  { "path": "D:\\\\Projects" }',
    'Relative paths (e.g. "documents/work") are resolved from the user home directory automatically.',
    'NEVER emit paths like C:\\Windows, C:\\Program Files, or any C:\\ path outside C:\\Users\\.',
    '',
    'COMMON TASK EXAMPLES:',
    '  User: "create a folder on the desktop called Test"',
    '    → { "tool": "createDirectory", "args": { "path": "desktop/Test" } }',
    '  User: "create a folder in D:\\Projects called MyApp"',
    '    → { "tool": "createDirectory", "args": { "path": "D:\\Projects\\MyApp" } }',
    '  User: "open notepad"',
    '    → { "tool": "screenAutomation", "args": { "action": "launch", "app": "notepad" } }',
    '  User: "open Excel"',
    '    → { "tool": "screenAutomation", "args": { "action": "launch", "app": "excel" } }',
    '  User: "organise downloads by type"',
    '    → { "tool": "organiseByRule", "args": { "source_dir": "downloads", "rule": "by_type", "dry_run": true } }',
    '  User: "from last week downloads, organise by images videos pdfs and other"',
    '    → { "tool": "organiseByRule", "args": { "source_dir": "downloads", "rule": "by_category", "since": "last_week", "dry_run": true } }',
    '  User: "organise last month downloads by category"',
    '    → { "tool": "organiseByRule", "args": { "source_dir": "downloads", "rule": "by_category", "since": "last_month", "dry_run": true } }',
    '    → { "tool": "listFiles", "args": { "path": "d:" } }',
    '  User: "navigate to downloads folder" / "open downloads in explorer"',
    '    → { "tool": "screenAutomation", "args": { "action": "navigate", "path": "downloads" } }',
    '  User: "open resume.pdf from downloads"',
    '    → { "tool": "screenAutomation", "args": { "action": "navigate", "path": "downloads", "file": "resume.pdf" } }',
    '  User: "go to D:\\Projects"',
    '    → { "tool": "screenAutomation", "args": { "action": "navigate", "path": "D:\\Projects" } }',
    '',
    'RESPONSE RULES (strictly enforced):',
    '1. Always output a single valid JSON object — no markdown, no code fences, no extra text.',
    '2. When the user wants to perform a file-system action, output ONLY:',
    '     { "tool": "<toolName>", "args": { <tool-specific args> } }',
    '3. For all other (conversational) requests, output ONLY:',
    '     { "response": "<your answer>" }',
    '4. Never mix tool and response keys in the same object.',
    '5. ALWAYS resolve path aliases as instructed — never output a raw username path like C:\\Users\\<name>.',
    '6. For createDirectory, use the exact folder alias or absolute path the user specifies — never default to home.'
].join('\n');

// ── Client ───────────────────────────────────────────────────────────────────

export class OllamaClient {
  private readonly model: string;

  constructor(model: string = MODEL) {
    this.model = model;
  }

  /**
   * Send a chat completion request to Ollama.
   *
   * The system prompt and `format: "json"` are injected automatically so
   * every response is guaranteed to be a valid JSON object.
   *
   * @param messages - Conversation history (without a system message).
   *                   A JSON-enforcement system message is prepended internally.
   * @returns        The parsed {@link OllamaJsonPayload} from the model.
   */
  async chat(
    messages: OllamaMessage[],
  ): Promise<OllamaJsonPayload> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 3000;

    let lastError: OllamaError | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS));
      }

      try {
        const response = await groq.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...messages,
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 1024,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) throw new OllamaError('Empty response from Groq');

        return parseJsonPayload(content);
      } catch (cause) {
        if (cause instanceof OllamaError) throw cause;

        if (cause instanceof OpenAI.APIError) {
          const err = new OllamaError(
            `Groq request failed [${cause.status}]: ${cause.message}`,
            cause.status ?? undefined,
            cause.message,
          );
          // Retry on rate-limit (429) or temporary server errors (503).
          if (cause.status === 429 || cause.status === 503) {
            lastError = err;
            continue;
          }
          throw err;
        }

        throw new OllamaError(
          `Cannot connect to Groq — ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }

    throw lastError!;
  }

  /**
   * Convenience wrapper — sends a single user message and returns the parsed
   * JSON payload.
   */
  async ask(userMessage: string): Promise<OllamaJsonPayload> {
    return this.chat([{ role: 'user', content: userMessage }]);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse the model's content string into an {@link OllamaJsonPayload}.
 * Strips any accidental markdown fences before parsing.
 */
function parseJsonPayload(content: string): OllamaJsonPayload {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    let parsed: unknown = JSON.parse(cleaned);

    // Normalise: the model sometimes emits { "action": "toolName", "args": {...} }
    // instead of the required { "tool": "toolName", "args": {...} }.
    // Remap `action` → `tool` at the top level so the payload validates.
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

    const result = OllamaJsonPayloadSchema.safeParse(parsed);
    if (result.success) return result.data;
    // Payload didn't match the schema — surface raw text so callers can inspect it.
    return { response: content };
  } catch {
    // JSON.parse failed — surface raw text so callers can inspect it.
    return { response: content };
  }
}

// ── Error class ───────────────────────────────────────────────────────────────

export class OllamaError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly rawBody?: string,
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

/** Pre-configured client instance ready for use throughout the app. */
export const ollamaClient = new OllamaClient();
