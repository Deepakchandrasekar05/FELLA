// engine.ts — Stateful conversation engine bridging the CLI and Ollama

import { join, basename, dirname } from 'node:path';
import { rename, mkdir, rm, rmdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { ollamaClient, OllamaError } from '../llm/ollama.js';
import type { OllamaMessage } from '../llm/schema.js';
import { resolvePath } from '../security/pathGuard.js';
import { executeTool, resolveToolName } from '../tools/registry.js';
import { UndoStack }            from './history.js';
import { buildPlan, executePlan, resolveSinceDate } from '../tools/organiseByRule.js';

/** Soft-delete staging area — files are moved here instead of permanently removed. */
const TRASH_DIR = join(tmpdir(), '.fella-trash');

/**
 * Set FELLA_MOCK=1 in the environment to bypass Ollama entirely.
 * The engine will echo the user's input as a formatted mock response.
 * Useful for testing the CLI pipeline when Ollama is not running.
 */
const MOCK_MODE = process.env['FELLA_MOCK'] === '1';

/** Stored args for a destructive tool awaiting user confirmation. */
interface PendingConfirmation {
  tool: string;
  args: Record<string, unknown>;
}

const CONFIRM_WORDS = new Set(['yes', 'y', 'confirm', 'do it', 'proceed', 'ok', 'sure']);
const CANCEL_WORDS  = new Set(['no', 'n', 'cancel', 'stop', 'abort', 'nope']);

// ── Engine ────────────────────────────────────────────────────────────────────

/**
 * Manages the full conversation history and delegates each turn to the
 * Ollama client.  One `Engine` instance should be created per session and
 * reused across all messages so the model retains context.
 */
export class Engine {
  /** Rolling conversation history sent to the model on every turn. */
  private history: OllamaMessage[] = [];

  /** Pending destructive action awaiting "yes" confirmation. */
  private pendingConfirmation: PendingConfirmation | null = null;

  /** Undo / Redo stack — tracks reversible file operations. */
  private undoStack = new UndoStack();

  // ── Private: execute a tool and record a matching undo entry ───────────────

  /**
   * Execute `tool` with `args`, record an undo/redo entry for reversible
   * operations, and return the human-readable result string.
   *
   * Special handling:
   *  - `deleteFile`           — soft-delete via TRASH_DIR so the operation
   *                             is always reversible.
   *  - `organiseByRule` (run) — uses buildPlan/executePlan to capture the
   *                             exact list of moves made.
   *  - `moveFile`             — records the inverse rename.
   *  - `createDirectory`      — records a safe (non-recursive) rmdir so the
   *                             undo only succeeds when the folder is still empty.
   */
  private async executeWithHistory(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const resolved = resolveToolName(tool);

    // ── deleteFile: move to trash ─────────────────────────────────────────
    if (resolved === 'deleteFile') {
      const filePath = String(args['path'] ?? '');
      if (!filePath) throw new Error('deleteFile: "path" argument is required');
      const resolvedPath = resolvePath(filePath);
      await access(resolvedPath); // throws ENOENT if missing

      await mkdir(TRASH_DIR, { recursive: true });
      const trashPath = join(TRASH_DIR, `${Date.now()}_${basename(resolvedPath)}`);
      await rename(resolvedPath, trashPath);

      this.undoStack.push({
        description: `delete ${basename(resolvedPath)}`,
        undo: async () => {
          await mkdir(dirname(resolvedPath), { recursive: true });
          await rename(trashPath, resolvedPath);
        },
        redo: async () => {
          await mkdir(TRASH_DIR, { recursive: true });
          await rename(resolvedPath, trashPath);
        },
      });
      return `Deleted: ${resolvedPath}`;
    }

    // ── organiseByRule (execute): capture actual moves for undo ───────────
    if (resolved === 'organiseByRule' && args['dry_run'] === false) {
      const rawDir   = String(args['source_dir'] ?? '');
      const rule     = String(args['rule']       ?? 'by_type');
      const sinceRaw = args['since'] != null ? String(args['since']) : null;

      if (!rawDir) throw new Error('organiseByRule: "source_dir" argument is required');

      let since: Date | undefined;
      if (sinceRaw) {
        const sinceDate = resolveSinceDate(sinceRaw);
        if (!sinceDate) throw new Error(`organiseByRule: invalid "since" value: "${sinceRaw}"`);
        since = sinceDate;
      }

      const sourceDir = resolvePath(rawDir);
      const plan      = buildPlan(sourceDir, rule, since);
      const { moved, skipped, errors, actualMoves } = executePlan(plan);

      if (actualMoves.length > 0) {
        this.undoStack.push({
          description: `organise ${actualMoves.length} file${actualMoves.length !== 1 ? 's' : ''} in ${basename(sourceDir)}`,
          undo: async () => {
            for (const { source, destination } of [...actualMoves].reverse()) {
              await mkdir(dirname(source), { recursive: true });
              await rename(destination, source);
            }
          },
          redo: async () => {
            for (const { source, destination } of actualMoves) {
              await mkdir(dirname(destination), { recursive: true });
              await rename(source, destination);
            }
          },
        });
      }

      const parts = [`Moved ${moved} of ${plan.length} files`];
      if (skipped)       parts.push(`${skipped} skipped (already exist)`);
      if (errors.length) parts.push(`${errors.length} error(s):\n  ${errors.join('\n  ')}`);
      return parts.join('\n');
    }

    // ── Standard execution ────────────────────────────────────────────────
    const result = await executeTool(tool, args);

    if (resolved === 'moveFile') {
      const src  = resolvePath(String(args['source']      ?? ''));
      const dest = resolvePath(String(args['destination'] ?? ''));
      this.undoStack.push({
        description: `move "${basename(src)}" → "${basename(dest)}"`,
        undo: async () => { await rename(dest, src); },
        redo: async () => {
          await mkdir(dirname(dest), { recursive: true });
          await rename(src, dest);
        },
      });
    } else if (resolved === 'createDirectory') {
      const dirPath = resolvePath(String(args['path'] ?? ''));
      this.undoStack.push({
        description: `create folder "${basename(dirPath)}"`,
        // Use non-recursive rmdir so undo only works when the folder is still empty
        undo: async () => {
          try {
            await rmdir(dirPath);
          } catch {
            throw new Error(`Cannot undo: folder "${basename(dirPath)}" is not empty or already removed`);
          }
        },
        redo: async () => { await mkdir(dirPath, { recursive: true }); },
      });
    }

    return result;
  }

  /**
   * Send a user message to the model and return the assistant's reply as a
   * plain string ready to display in the UI.
   *
   * The user message is appended to history before the request and the
   * assistant reply is appended after, so every subsequent call carries the
   * full context.
   *
   * @throws {OllamaError} if the HTTP request to Ollama fails.
   */
  async send(userMessage: string): Promise<string> {
    // ── Undo / Redo keyword bypass ────────────────────────────────────────────
    const trimmed = userMessage.trim().toLowerCase();
    if (/^undo(\s+(the\s+)?(last\s+)?(operation|action|that|previous))?[.!]?$/i.test(trimmed)) {
      this.history.push({ role: 'user', content: userMessage });
      let reply: string;
      try {
        reply = await this.undoStack.undo();
      } catch (err) {
        reply = `Undo failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: 'assistant', content: reply });
      return reply;
    }
    if (/^redo(\s+(the\s+)?(last\s+)?(operation|action|that|previous))?[.!]?$/i.test(trimmed)) {
      this.history.push({ role: 'user', content: userMessage });
      let reply: string;
      try {
        reply = await this.undoStack.redo();
      } catch (err) {
        reply = `Redo failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: 'assistant', content: reply });
      return reply;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Keyword bypass — create folder directly without going through LLM ────
    const createFolderMatch = userMessage
      .trim()
      .match(
        /^(?:create|make|new)\s+(?:a\s+)?(?:folder|directory|dir)\s+(?:(?:on|in)\s+(?:the\s+)?)?([^\s].+?)\s+(?:called|named)\s+(.+)$/i,
      );
    if (createFolderMatch) {
      const location   = createFolderMatch[1]!.trim();   // e.g. "desktop"
      const folderName = createFolderMatch[2]!.trim();   // e.g. "MyNewFolder"
      const fullPath   = join(resolvePath(location), folderName);
      this.history.push({ role: 'user', content: userMessage });
      let reply: string;
      try {
        reply = await this.executeWithHistory('createDirectory', { path: fullPath });
      } catch (err) {
        reply = `Create folder error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: 'assistant', content: reply! });
      return reply!;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Keyword bypass — navigate Explorer to a folder / open a file ──────
    //  "navigate to downloads"         → navigate, path=downloads
    //  "open downloads folder"         → navigate, path=downloads
    //  "go to D:\Projects"             → navigate, path=D:\Projects
    //  "open report.pdf from downloads"→ navigate, path=downloads, file=report.pdf
    //  "open report.pdf in documents"  → navigate, path=documents, file=report.pdf
    const navigateMatch = userMessage
      .trim()
      .match(
        /^(?:navigate\s+to|go\s+to|open|show(?:\s+me)?)\s+(?:the\s+)?([^\s].+?)(?:\s+folder)?$/i,
      );
    const openFileMatch = userMessage
      .trim()
      .match(
        /^open\s+(.+?)\s+(?:from|in|inside)\s+(?:the\s+)?(.+?)(?:\s+folder)?$/i,
      );

    if (openFileMatch) {
      const fileName   = openFileMatch[1]!.trim();
      const folderName = openFileMatch[2]!.trim();
      this.history.push({ role: 'user', content: userMessage });
      let reply: string;
      try {
        reply = await executeTool('screenAutomation', {
          action: 'navigate',
          path:   folderName,
          file:   fileName,
        });
      } catch (err) {
        reply = `Navigate error: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: 'assistant', content: reply! });
      return reply!;
    }

    // Known folder names for the plain "navigate to X" bypass
    const FOLDER_ALIASES = new Set([
      'downloads', 'download', 'documents', 'document', 'docs',
      'desktop', 'pictures', 'picture', 'photos', 'music',
      'videos', 'video', 'movies', 'temp', 'tmp', 'home',
      'appdata', 'localappdata', 'd:', 'droot',
      // Windows virtual / shell folders
      'recyclebin', 'trash', 'thispc', 'mycomputer', 'controlpanel', 'network',
    ]);
    if (navigateMatch) {
      const target = navigateMatch[1]!.trim().toLowerCase().replace(/\s+/g, '');
      const isKnownFolder = FOLDER_ALIASES.has(target)
        || /^[a-z]:[\\\/]/.test(navigateMatch[1]!.trim());   // absolute path
      if (isKnownFolder) {
        this.history.push({ role: 'user', content: userMessage });
        let reply: string;
        try {
          reply = await executeTool('screenAutomation', {
            action: 'navigate',
            path: navigateMatch[1]!.trim(),
          });
        } catch (err) {
          reply = `Navigate error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: 'assistant', content: reply! });
        return reply!;
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Keyword bypass — directly launch apps without risking LLM non-compliance ─
    const launchMatch = userMessage
      .trim()
      .match(/^(?:open|launch|start|run)\s+([a-z0-9 _.-]+)$/i);
    if (launchMatch) {
      const appName = launchMatch[1]!.trim().toLowerCase();
      // Only bypass for known app names to avoid false positives
        // Always bypass — Win+R handles any executable name or .exe gracefully.
      if (true) {
        this.history.push({ role: 'user', content: userMessage });
        let reply: string;
        try {
          reply = await executeTool('screenAutomation', { action: 'launch', app: appName });
        } catch (err) {
          reply = `Launch error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: 'assistant', content: reply! });
        return reply!;
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Confirmation gate — handles yes/no for pending destructive actions ────
    if (this.pendingConfirmation) {
      const token = userMessage.trim().toLowerCase();

      if (CONFIRM_WORDS.has(token)) {
        const { tool, args } = this.pendingConfirmation;
        this.pendingConfirmation = null;
        let reply: string;
        try {
          reply = await this.executeWithHistory(tool, args);
        } catch (err) {
          reply = `Tool error (${tool}): ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: 'user',      content: userMessage });
        this.history.push({ role: 'assistant', content: reply! });
        return reply!;
      }

      if (CANCEL_WORDS.has(token)) {
        this.pendingConfirmation = null;
        const reply = 'Cancelled — no files were moved.';
        this.history.push({ role: 'user',      content: userMessage });
        this.history.push({ role: 'assistant', content: reply });
        return reply;
      }

      // User said something else — clear pending and fall through to LLM
      this.pendingConfirmation = null;
    }
    // ──────────────────────────────────────────────────────────────────────

    // Append the user turn to history
    this.history.push({ role: 'user', content: userMessage });

    // ── Mock mode (FELLA_MOCK=1) ─────────────────────────────────────────────
    if (MOCK_MODE) {
      const reply = `[mock] You said: "${userMessage}"`;
      this.history.push({ role: 'assistant', content: reply });
      return reply;
    }
    // ─────────────────────────────────────────────────────────────────────────

    try {
      const payload = await ollamaClient.chat(this.history);

      // ── Tool-call path ──────────────────────────────────────────────────────
      if (payload.tool) {
        const args        = (payload.args ?? {}) as Record<string, unknown>;
        const resolvedTool = resolveToolName(payload.tool);
        let reply: string;
        try {
          reply = await this.executeWithHistory(payload.tool, args);

          // organiseByRule with dry_run (default) — store pending confirmation
          if (resolvedTool === 'organiseByRule' && args['dry_run'] !== false) {
            this.pendingConfirmation = {
              tool: 'organiseByRule',
              args: { ...args, dry_run: false },
            };
          }
        } catch (toolErr) {
          reply = `Tool error (${payload.tool}): ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`;
        }
        this.history.push({ role: 'assistant', content: reply! });
        return reply!;
      }

      // ── Conversational path ─────────────────────────────────────────────────
      let reply: string;

      if (payload.error) {
        reply = `Error from model: ${payload.error}`;
      } else if (typeof payload.response === 'string' && payload.response.trim()) {
        reply = payload.response.trim();
      } else {
        reply = '(no response)';
      }

      // Append the assistant turn to history
      this.history.push({ role: 'assistant', content: reply });

      return reply;
    } catch (err) {
      // Remove the user turn we just added so history stays consistent
      this.history.pop();

      if (err instanceof OllamaError) {
        throw err;
      }
      throw new Error(
        err instanceof Error ? err.message : 'Unknown error communicating with Ollama',
      );
    }
  }

  /** Clear the conversation history and undo stack to start a fresh session. */
  reset(): void {
    this.history = [];
    this.pendingConfirmation = null;
    this.undoStack.clear();
  }

  /** Read-only snapshot of the current conversation history. */
  get turns(): ReadonlyArray<OllamaMessage> {
    return this.history;
  }
}
