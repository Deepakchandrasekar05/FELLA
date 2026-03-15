// engine.ts — Stateful conversation engine bridging the CLI and Ollama

import { join, basename, dirname, extname } from 'node:path';
import { rename, mkdir, rm, rmdir, access } from 'node:fs/promises';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { AgentLoop, AgentLoopHalt, type AgentStep } from '../agent/loop.js';
import type { OllamaMessage } from '../llm/schema.js';
import { resolvePath } from '../security/pathGuard.js';
import { executeTool, resolveToolName } from '../tools/registry.js';
import { UndoStack }            from './history.js';
import { buildPlan, executePlan, resolveSinceDate } from '../tools/organiseByRule.js';
import { MemoryStore } from '../memory/store.js';

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

interface PendingSelection {
  kind: 'navigate-folder' | 'delete-folder';
  options: string[];
}

const CONFIRM_WORDS = new Set(['yes', 'y', 'confirm', 'do it', 'proceed', 'ok', 'sure']);
const CANCEL_WORDS  = new Set(['no', 'n', 'cancel', 'stop', 'abort', 'nope']);

const FOLDER_SEARCH_MAX_DEPTH = 8;
const FOLDER_SEARCH_MAX_RESULTS = 8;
const DEFAULT_SEARCH_DIRS = [
  'downloads',
  'documents',
  'desktop',
  'videos',
  'pictures',
  'music',
  'd:',
];

const SYSTEM_DIRS = new Set([
  'windows',
  'system32',
  'syswow64',
  'sysarm32',
  'program files',
  'program files (x86)',
  'programdata',
  'system volume information',
  'recovery',
  'boot',
  'efi',
  'winsxs',
  'servicing',
]);

const JUNK_DIRS = new Set([
  '$recycle.bin',
  '$recycler',
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.tmp',
  'temp',
]);

type FolderMatch = {
  path: string;
  name: string;
  score: number;
  depth: number;
};

function tokenise(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 1);
}

function scoreName(name: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const tokens = tokenise(name);
  let hits = 0;
  for (const queryToken of queryTokens) {
    if (tokens.some((token) => token.includes(queryToken) || queryToken.includes(token))) {
      hits += 1;
    }
  }
  return hits / queryTokens.length;
}

function isSystemDir(name: string): boolean {
  return SYSTEM_DIRS.has(name.toLowerCase());
}

function isJunkDir(name: string): boolean {
  return JUNK_DIRS.has(name.toLowerCase()) || name.startsWith('$');
}

function walkFolders(
  dir: string,
  queryTokens: string[],
  depth: number,
  results: FolderMatch[],
): void {
  if (depth > FOLDER_SEARCH_MAX_DEPTH || results.length >= FOLDER_SEARCH_MAX_RESULTS * 4) return;

  let entries: import('node:fs').Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as import('node:fs').Dirent<string>[];
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const name = String(entry.name);
    if (isSystemDir(name) || isJunkDir(name)) continue;

    const fullPath = join(dir, name);
    const matchScore = scoreName(name, queryTokens);
    if (matchScore >= 1) {
      results.push({ path: fullPath, name, score: matchScore, depth });
    }

    walkFolders(fullPath, queryTokens, depth + 1, results);
  }
}

function findFoldersByName(folderName: string): string[] {
  const queryTokens = tokenise(folderName.trim());
  if (queryTokens.length === 0) return [];

  const searchRoots = DEFAULT_SEARCH_DIRS.flatMap((dir) => {
    try {
      const resolved = resolvePath(dir);
      return existsSync(resolved) ? [resolved] : [];
    } catch {
      return [];
    }
  });

  const matches: FolderMatch[] = [];
  for (const root of searchRoots) {
    const rootName = basename(root);
    const rootScore = scoreName(rootName, queryTokens);
    if (rootScore >= 1) {
      matches.push({ path: root, name: rootName, score: rootScore, depth: 0 });
    }
    walkFolders(root, queryTokens, 1, matches);
  }

  const unique = matches.filter((match, index, all) =>
    all.findIndex((candidate) => candidate.path === match.path) === index,
  );

  unique.sort((left, right) => left.depth - right.depth || left.name.length - right.name.length || left.path.localeCompare(right.path));
  return unique.slice(0, FOLDER_SEARCH_MAX_RESULTS).map((match) => match.path);
}

function buildFolderChoicePrompt(folderName: string, options: string[]): string {
  const lines = options.map((option, index) => `${index + 1}. ${option}`);
  return `I found multiple folders named "${folderName}". Which one should I open?\n${lines.join('\n')}`;
}

function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toTimeString().slice(0, 5).replace(':', '');
  const rand = randomBytes(2).toString('hex');
  return `sess-${date}-${time}-${rand}`;
}

function isVisibleTurn(role: string, content: string): boolean {
  if (role === 'user') {
    return (
      !content.startsWith('Tool result:') &&
      !content.includes('Continue working toward the goal:')
    );
  }
  if (role === 'assistant') {
    const trimmed = content.trim();
    return !(trimmed.startsWith('{') && trimmed.endsWith('}'));
  }
  return false;
}

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

  /** Pending folder disambiguation awaiting a numeric selection. */
  private pendingSelection: PendingSelection | null = null;

  /** Undo / Redo stack — tracks reversible file operations. */
  private undoStack = new UndoStack();

  /** ReAct loop runner used for multi-step planning and tool use. */
  private agentLoop: AgentLoop;

  /** Persistent store that owns the session turns table. */
  private sessionStore: MemoryStore;

  /** Unique identifier for this session, shown to the user. */
  private _sessionId: string;

  /** Tracks whether a row exists in the sessions table for this engine. */
  private sessionCreated: boolean;

  /** Index into this.history up to which turns have already been persisted. */
  private lastSavedIdx = 0;

  constructor(resumeSessionId?: string) {
    this.sessionStore = new MemoryStore();

    if (resumeSessionId) {
      const turns = this.sessionStore.loadSessionHistory(resumeSessionId);
      this.history = turns.map((t) => ({
        role: t.role as OllamaMessage['role'],
        content: t.content,
      }));
      this._sessionId = resumeSessionId;
      this.sessionCreated = true;
    } else {
      this._sessionId = generateSessionId();
      // Delay session row creation until we have at least one persisted turn.
      this.sessionCreated = false;
    }

    this.lastSavedIdx = this.history.length;

    this.agentLoop = new AgentLoop({
      maxSteps: 8,
      executeTool: async (tool, args) => this.executeAgentTool(tool, args),
    });
  }

  /** Unique identifier for this session. */
  get id(): string {
    return this._sessionId;
  }

  /** Returns visible turns from this session for UI reconstruction on resume. */
  getVisibleHistory(): Array<{ role: string; content: string }> {
    return this.sessionStore
      .loadSessionHistory(this._sessionId)
      .filter((t) => t.visible)
      .map((t) => ({ role: t.role, content: t.content }));
  }

  /** Persist any new history messages added since the last checkpoint. */
  private persistDelta(): void {
    const newMessages = this.history.slice(this.lastSavedIdx);
    if (newMessages.length > 0 && !this.sessionCreated) {
      this.sessionStore.createSession(this._sessionId);
      this.sessionCreated = true;
    }
    const now = new Date().toISOString();
    for (const msg of newMessages) {
      this.sessionStore.appendTurn(
        this._sessionId,
        msg.role,
        msg.content,
        now,
        isVisibleTurn(msg.role, msg.content),
      );
    }
    if (newMessages.length > 0) {
      this.sessionStore.touchSession(this._sessionId);
    }
    this.lastSavedIdx = this.history.length;
  }

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
      try {
        await rename(resolvedPath, trashPath);
      } catch (renameErr) {
        if ((renameErr as NodeJS.ErrnoException).code === 'EXDEV') {
          // Cross-drive move — fall back to a destructive delete (no undo available)
          await rm(resolvedPath, { recursive: true, force: true });
          return `Deleted: ${resolvedPath}`;
        }
        throw renameErr;
      }

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
   * Engine-specific execution policy layered on top of tool execution.
   * This keeps confirmation gates and deferred execution logic in one place.
   */
  private async executeAgentTool(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const resolvedTool = resolveToolName(tool);

    if (resolvedTool === 'deleteFile') {
      const filePath = String(args['path'] ?? '');
      this.pendingConfirmation = { tool: 'deleteFile', args };
      throw new AgentLoopHalt(
        `Are you sure you want to delete "${filePath}"? This cannot be undone. (yes / no)`,
      );
    }

    const result = await this.executeWithHistory(tool, args);

    // organiseByRule with dry_run queues the execute step for explicit confirmation.
    if (resolvedTool === 'organiseByRule' && args['dry_run'] !== false) {
      this.pendingConfirmation = {
        tool: 'organiseByRule',
        args: { ...args, dry_run: false },
      };
    }

    return result;
  }

  /**
   * Public entry-point: delegates to sendInner and persists the new history
   * turns unconditionally (even on error) via a finally block.
   */
  async send(
    userMessage: string,
    onStep?: (step: AgentStep) => void,
  ): Promise<string> {
    try {
      return await this.sendInner(userMessage, onStep);
    } finally {
      this.persistDelta();
    }
  }

  private async sendInner(
    userMessage: string,
    onStep?: (step: AgentStep) => void,
  ): Promise<string> {
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

    if (this.pendingSelection) {
      const selection = Number.parseInt(userMessage.trim(), 10);
      if (Number.isInteger(selection)) {
        const chosenPath = this.pendingSelection.options[selection - 1];
        if (chosenPath) {
          const kind = this.pendingSelection.kind;
          this.pendingSelection = null;
          this.history.push({ role: 'user', content: userMessage });
          let reply: string;
          if (kind === 'delete-folder') {
            this.pendingConfirmation = { tool: 'deleteFile', args: { path: chosenPath } };
            reply = `Are you sure you want to permanently delete "${chosenPath}" and all its contents? (yes / no)`;
          } else {
            try {
              reply = await executeTool('screenAutomation', {
                action: 'navigate',
                path: chosenPath,
              });
            } catch (err) {
              reply = `Navigate error: ${err instanceof Error ? err.message : String(err)}`;
            }
          }
          this.history.push({ role: 'assistant', content: reply! });
          return reply!;
        }

        const reply = `Please choose a number between 1 and ${this.pendingSelection.options.length}.`;
        this.history.push({ role: 'user', content: userMessage });
        this.history.push({ role: 'assistant', content: reply });
        return reply;
      }

      if (CANCEL_WORDS.has(trimmed)) {
        this.pendingSelection = null;
        const reply = 'Cancelled.';
        this.history.push({ role: 'user', content: userMessage });
        this.history.push({ role: 'assistant', content: reply });
        return reply;
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const openFolderMatch = userMessage
      .trim()
      .match(/^(?:open|show(?:\s+me)?|navigate\s+to|go\s+to)\s+(?:the\s+)?(.+?)\s+folder(?:\s+.*)?$/i);
    if (openFolderMatch) {
      const folderName = openFolderMatch[1]!.trim();
      const folders = findFoldersByName(folderName);

      this.history.push({ role: 'user', content: userMessage });

      if (folders.length === 0) {
        const reply = `I couldn't find a folder named "${folderName}".`;
        this.history.push({ role: 'assistant', content: reply });
        return reply;
      }

      if (folders.length === 1) {
        let reply: string;
        try {
          reply = await executeTool('screenAutomation', {
            action: 'navigate',
            path: folders[0],
          });
        } catch (err) {
          reply = `Navigate error: ${err instanceof Error ? err.message : String(err)}`;
        }
        this.history.push({ role: 'assistant', content: reply });
        return reply;
      }

      this.pendingSelection = {
        kind: 'navigate-folder',
        options: folders,
      };
      const reply = buildFolderChoicePrompt(folderName, folders);
      this.history.push({ role: 'assistant', content: reply });
      return reply;
    }
    // ─────────────────────────────────────────────────────────────────────────

  // ── Keyword bypass — delete folder directly without going through LLM ────
  const deleteFolderMatch = userMessage
      .trim()
      .match(/^(?:delete|remove|trash|erase)\s+(?:the\s+)?(.+?)\s+folder(?:\s+.*)?$/i);
    if (deleteFolderMatch) {
      const folderName = deleteFolderMatch[1]!.trim();
      const folders = findFoldersByName(folderName);

      this.history.push({ role: 'user', content: userMessage });

      if (folders.length === 0) {
        const reply = `I couldn't find a folder named "${folderName}".`;
        this.history.push({ role: 'assistant', content: reply });
        return reply;
      }

      if (folders.length === 1) {
        this.pendingConfirmation = { tool: 'deleteFile', args: { path: folders[0] } };
        const reply = `Are you sure you want to permanently delete "${folders[0]}" and all its contents? (yes / no)`;
        this.history.push({ role: 'assistant', content: reply });
        return reply;
      }

      this.pendingSelection = { kind: 'delete-folder', options: folders };
      const lines = folders.map((f, i) => `${i + 1}. ${f}`);
      const reply = `I found multiple folders named "${folderName}". Which one should I delete?\n${lines.join('\n')}`;
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

    // ── Keyword bypass — navigate Explorer to a known folder alias / absolute path ──
    //  "navigate to downloads"  → navigate, path=downloads
    //  "go to D:\Projects"      → navigate, path=D:\Projects
    // Complex queries like "open X in folder named Y" fall through to the LLM.
    const navigateMatch = userMessage
      .trim()
      .match(
        /^(?:navigate\s+to|go\s+to|show(?:\s+me)?)\s+(?:the\s+)?([^\s].+?)(?:\s+folder)?$/i,
      );

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

    // ── Keyword bypass — "open the last/latest/recently downloaded <type>" ──────
    // e.g. "open the lastly downloaded image", "open latest downloaded pdf"
    const openLastDownloadedMatch = userMessage.trim().match(
      /^open\s+(?:the\s+)?(?:last(?:ly|est)?\s+downloaded|latest\s+downloaded|most\s+recent(?:ly)?\s+downloaded|recently\s+downloaded)\s+(.+)$/i,
    );
    if (openLastDownloadedMatch) {
      const typeHint = openLastDownloadedMatch[1]!.trim().toLowerCase();

      // Map type hints to extensions
      const TYPE_EXT_MAP: Record<string, string[]> = {
        image:    ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.avif', '.tiff', '.svg'],
        photo:    ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.avif'],
        picture:  ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.avif'],
        video:    ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'],
        audio:    ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma'],
        pdf:      ['.pdf'],
        document: ['.pdf', '.docx', '.doc', '.txt', '.odt', '.rtf'],
        zip:      ['.zip', '.rar', '.7z', '.tar', '.gz'],
        archive:  ['.zip', '.rar', '.7z', '.tar', '.gz'],
        exe:      ['.exe', '.msi'],
        installer:['.exe', '.msi'],
      };

      const allowedExts = TYPE_EXT_MAP[typeHint] ?? null; // null = any file

      this.history.push({ role: 'user', content: userMessage });
      let reply: string;
      try {
        const downloadsDir = resolvePath('downloads');
        const entries = readdirSync(downloadsDir, { withFileTypes: true });
        const files = entries
          .filter((e) => {
            if (!e.isFile()) return false;
            if (!allowedExts) return true;
            return allowedExts.includes(extname(e.name).toLowerCase());
          })
          .map((e) => ({
            name:  e.name,
            mtime: statSync(join(downloadsDir, e.name)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime);

        if (files.length === 0) {
          reply = allowedExts
            ? `No ${typeHint} files found in Downloads.`
            : 'Downloads folder is empty.';
        } else {
          const newest = files[0]!;
          reply = await executeTool('screenAutomation', {
            action: 'navigate',
            path:   'downloads',
            file:   newest.name,
          });
          reply = `Opening latest downloaded ${typeHint}: "${newest.name}"\n${reply}`;
        }
      } catch (err) {
        reply = `Error opening last downloaded ${typeHint}: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.history.push({ role: 'assistant', content: reply });
      return reply;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Keyword bypass — directly launch apps without risking LLM non-compliance ─
    // Only matches short, app-name-like strings (no "the", "lastly", "downloaded", etc.)
    const launchMatch = userMessage
      .trim()
      .match(/^(?:open|launch|start|run)\s+([a-z0-9][a-z0-9 _.-]{0,40})$/i);
    if (launchMatch) {
      const appName = launchMatch[1]!.trim().toLowerCase();
      // Reject if it looks like a sentence fragment (contains common filler words)
      const SENTENCE_WORDS = /\b(?:the|a|an|my|this|that|last(?:ly|est)?|latest|recent(?:ly)?|downloaded|file|image|photo|video|document|folder|from|in|on|to)\b/i;
      // Reject if it looks like a filename (has a document/media extension) — let the LLM handle it
      const FILE_EXT = /\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|odt|rtf|mp4|mkv|avi|mov|wmv|mp3|flac|aac|jpg|jpeg|png|gif|webp|zip|rar|7z|exe|msi|iso)$/i;
      if (!SENTENCE_WORDS.test(appName) && !FILE_EXT.test(appName)) {
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
        const reply = 'Cancelled — no changes were made.';
        this.history.push({ role: 'user',      content: userMessage });
        this.history.push({ role: 'assistant', content: reply });
        return reply;
      }

      // User said something else — clear pending and fall through to LLM
      this.pendingConfirmation = null;
    }
    // ──────────────────────────────────────────────────────────────────────

    // ── Mock mode (FELLA_MOCK=1) ─────────────────────────────────────────────
    if (MOCK_MODE) {
      const reply = `[mock] You said: "${userMessage}"`;
      this.history.push({ role: 'user', content: userMessage });
      this.history.push({ role: 'assistant', content: reply });
      return reply;
    }
    // ─────────────────────────────────────────────────────────────────────────

    try {
      const result = await this.agentLoop.run(userMessage, this.history, (step) => {
        onStep?.(step);
      });
      this.history = result.messages as OllamaMessage[];
      return result.finalResponse;
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : 'Unknown error communicating with Ollama',
      );
    }
  }

  /** Clear the conversation history and undo stack to start a fresh session. */
  reset(): void {
    this.history = [];
    this.pendingConfirmation = null;
    this.pendingSelection = null;
    this.undoStack.clear();
    this.lastSavedIdx = 0;
  }

  /** Read-only snapshot of the current conversation history. */
  get turns(): ReadonlyArray<OllamaMessage> {
    return this.history;
  }
}
