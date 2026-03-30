// ollama.ts — Groq client wired to llama-3.3-70b-versatile with JSON-only output

import OpenAI from 'openai';
import type { OllamaJsonPayload, OllamaMessage } from './schema.js';
import { OllamaJsonPayloadSchema } from './schema.js';

// ── Configuration ────────────────────────────────────────────────────────────

const MODEL = 'llama-3.3-70b-versatile';
const PLATFORM_LABEL = process.platform === 'win32'
  ? 'Windows'
  : process.platform === 'darwin'
    ? 'macOS'
    : 'Linux';

/**
 * Resolve API key lazily so dotenv-loaded values are available even though
 * this module is imported before src/index.tsx runs dotenv.config().
 */
let groqClient: OpenAI | null = null;
let groqClientKey = '';

function getGroqClient(): OpenAI {
  const key = process.env['GROQ_API_KEY'] ?? '';
  if (!key) {
    throw new OllamaError(
      'GROQ_API_KEY is missing. Add it to your runtime environment or .env file.',
    );
  }

  if (!groqClient || groqClientKey !== key) {
    groqClient = new OpenAI({
      apiKey: key,
      baseURL: 'https://api.groq.com/openai/v1',
    });
    groqClientKey = key;
  }

  return groqClient;
}

/**
 * System prompt that instructs the model to ALWAYS reply with a valid JSON
 * object and to emit a structured tool-call payload when the user's intent
 * maps to one of the registered tools.
 */
const SYSTEM_PROMPT: string = [
    `You are Fella, an agentic AI assistant that plans and executes multi-step tasks on the ${PLATFORM_LABEL} file system and browser.`,
    'You MUST respond with exactly ONE JSON object. No prose, no markdown, no explanation outside JSON.',
    '',
    'RESPONSE FORMAT (strictly enforced):',
    '  To call a tool:   { "tool": "<toolName>", "args": { <args> } }',
    '  To reply/confirm:  { "response": "<text>" }',
    '  Never mix tool and response keys. Never output anything outside JSON.',
    '',
    'ACCESS POLICY:',
    process.platform === 'win32'
      ? '  C:\\Users\\ and D:\\ are allowed; system folders are blocked.'
      : process.platform === 'darwin'
        ? '  User home, /Volumes, and temp directories are allowed; macOS system folders are blocked.'
        : '  User home, /media, /mnt, and temp directories are allowed; Linux system folders are blocked.',
    '',
    'TOOLS:',
    '  • createFile       — create a new empty file.               Args: { "path": string }',
    '  • writeFile        — write/append text content to a file.   Args: { "path": string, "content": string, "append"?: boolean }',
    '  • readFile         — read a text file for verification.     Args: { "path": string }',
    '  • findFile         — fuzzy recursive file search.           Args: { "query"?: string, "folder_hint"?: string, "dir"?: string, "extensions"?: string[], "sort_by"?: "score"|"recent" }',
    '  • listFiles        — list files/folders in a directory.     Args: { "path": string }',
    '  • deleteFile       — delete a file or folder.               Args: { "path": string }',
    '  • moveFile         — move or rename a file/folder.          Args: { "source": string, "destination": string, "create_parent"?: boolean }',
    '  • renameFile       — rename a file in its current folder.   Args: { "path": string, "newName": string }',
    '  • createDirectory  — create a new folder (recursive).       Args: { "path": string }',
    '  • organiseByRule   — batch-organise files in a directory.   Args: { "source_dir": string, "rule": "by_type"|"by_category"|"by_date"|"by_size"|"by_extension", "dry_run": boolean, "since"?: string }',
    '    IMPORTANT: always set dry_run=true first so the user sees a preview before files are moved.',
    '  • openSettings     — open a system settings page.           Args: { "setting": string }',
    '    Settings: wifi, bluetooth, display, sound, battery, storage, apps, updates, privacy, accounts, time, control panel',
    '  • screenAutomation — control the screen with mouse/keyboard.',
    '    Actions:',
    '      launch    — open an app visibly.     Args: { "action": "launch", "app": string }',
    '      navigate  — open folder/file.        Args: { "action": "navigate", "path": string, "file"?: string }',
    '      click     — click on text/coords.    Args: { "action": "click", "target"?: string, "x"?: number, "y"?: number }',
    '      type      — type text.               Args: { "action": "type", "text": string }',
    '      key       — press a key.             Args: { "action": "key", "key": string }',
    '      hotkey    — key combination.          Args: { "action": "hotkey", "keys": ["ctrl","c"] }',
    '      screenshot — capture screen.          Args: { "action": "screenshot" }',
    '      scroll    — scroll up/down.           Args: { "action": "scroll", "direction": "up"|"down" }',
    '      close_folder — close Explorer window. Args: { "action": "close_folder", "path"?: string }',
    '  • openApplication  — silently launch an app.                Args: { "app": string }',
    '  • browserAutomation — control Chrome browser via Playwright.',
    '    Actions:',
    '      navigate      — go to URL.           Args: { "action": "navigate", "url": string, "newTab"?: boolean }',
    '      click         — click element.        Args: { "action": "click", "text": string } or { "action": "click", "selector": string }',
    '      type          — type into field.      Args: { "action": "type", "text": string, "selector"?: string }',
    '      append_text   — append to Google Doc. Args: { "action": "append_text", "text": string }',
    '      search        — Google search.        Args: { "action": "search", "query": string }',
    '      createDocument — new Google Doc.      Args: { "action": "createDocument", "title"?: string }',
    '      rename_document — rename doc.         Args: { "action": "rename_document", "title": string }',
    '      get_text      — read page text.       Args: { "action": "get_text", "selector"?: string }',
    '      screenshot    — page screenshot.      Args: { "action": "screenshot" }',
    '      scroll        — scroll page.          Args: { "action": "scroll", "direction": "down"|"up" }',
    '      download_pdf  — save page as PDF.     Args: { "action": "download_pdf", "filename"?: string }',
    '      close_tab     — close current tab.    Args: { "action": "close_tab" }',
    '      close         — close browser.        Args: { "action": "close" }',
    '',
    'PATH ALIASES: downloads, documents, desktop, pictures, music, videos, temp, home',
    process.platform === 'win32' ? '  d: and droot map to D:\\.' : '',
    '  Example: { "path": "desktop/MyFile.txt" }',
    '',
    'AGENTIC RULES:',
    '  1. Execute tool calls IMMEDIATELY — do not explain what you will do, just do it.',
    '  2. For multi-step goals, issue one tool call at a time until complete.',
    '  3. ALWAYS verify mutating actions (create/write/move/delete) with readFile or listFiles before responding.',
    '  4. Only output { "response": "..." } when ALL steps and verification are done.',
    '  5. Use findFile when user refers to files by description, not exact path.',
    '  6. For browser tasks, use browserAutomation. For file tasks, use file tools directly.',
    '  7. NEVER output prose, markdown, or instructions — only JSON tool calls or responses.',
    '',
    'EXAMPLES:',
    '  User: "create a file named test.txt on the desktop"',
    '    → { "tool": "createFile", "args": { "path": "desktop/test.txt" } }',
    '  User: "create a text file named Sample and write hello world"',
    '    Step 1 → { "tool": "createFile", "args": { "path": "desktop/Sample.txt" } }',
    '    Step 2 → { "tool": "writeFile", "args": { "path": "desktop/Sample.txt", "content": "hello world" } }',
    '    Step 3 → { "tool": "readFile", "args": { "path": "desktop/Sample.txt" } }',
    '    Step 4 → { "response": "Done — created Sample.txt on your desktop and wrote your content." }',
    '  User: "open github.com"',
    '    → { "tool": "browserAutomation", "args": { "action": "navigate", "url": "https://github.com" } }',
    '  User: "open google docs in a new tab"',
    '    → { "tool": "browserAutomation", "args": { "action": "navigate", "url": "https://docs.google.com/", "newTab": true } }',
    '  User: "open notepad"',
    '    → { "tool": "screenAutomation", "args": { "action": "launch", "app": "notepad" } }',
    '  User: "show wifi settings"',
    '    → { "tool": "openSettings", "args": { "setting": "wifi" } }',
    '  User: "organise downloads by type"',
    '    → { "tool": "organiseByRule", "args": { "source_dir": "downloads", "rule": "by_type", "dry_run": true } }',
    '  User: "navigate to downloads folder"',
    '    → { "tool": "screenAutomation", "args": { "action": "navigate", "path": "downloads" } }',
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
        const response = await getGroqClient().chat.completions.create({
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
          const isJsonGenerationFailure =
            cause.status === 400 &&
            /failed to generate json/i.test(cause.message);

          if (isJsonGenerationFailure) {
            try {
              const fallback = await getGroqClient().chat.completions.create({
                model: this.model,
                messages: [
                  { role: 'system', content: SYSTEM_PROMPT },
                  {
                    role: 'system',
                    content:
                      'Output exactly one JSON object only. Valid shapes: {"tool":"name","args":{...}} or {"response":"..."}. No prose.',
                  },
                  ...messages,
                ],
                temperature: 0,
                max_tokens: 1024,
              });

              const fallbackContent = fallback.choices[0]?.message?.content;
              if (!fallbackContent) throw new OllamaError('Empty fallback response from Groq');
              return parseJsonPayload(fallbackContent);
            } catch {
              // Fall through to standard retry/error handling below.
            }
          }

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

  const tryParse = (raw: string): unknown | null => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  // First try direct parse.
  let parsed: unknown | null = tryParse(cleaned);

  // If direct parse fails, try extracting the first JSON object block.
  if (parsed === null) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      parsed = tryParse(cleaned.slice(firstBrace, lastBrace + 1));
    }
  }

  try {
    if (parsed === null) throw new Error('parse failed');

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
      const { action, args, ...rest } = p;
      parsed = { tool: action, args: args ?? rest };
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
