// findFile.ts — Fuzzy recursive file/folder search across common directories

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { resolvePath } from '../security/pathGuard.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_DEPTH   = 8;   // deep enough for D:\College\College\sem3\OOPS\file.pdf
const MAX_RESULTS = 8;

/** Default folders to search when no dir is specified. */
const DEFAULT_DIRS = [
  'downloads',
  'documents',
  'desktop',
  'videos',
  'pictures',
  'music',
  'd:',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Split a filename into lowercase tokens, handling underscores, hyphens,
 * dots, spaces, camelCase/PascalCase and digit-letter boundaries.
 * Extension is stripped first.
 */
function tokenise(name: string): string[] {
  return name
    .replace(/\.[^.]+$/, '')                       // strip extension
    .replace(/([a-z])([A-Z])/g, '$1 $2')           // camelCase → words
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')           // letter→digit boundary
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')           // digit→letter boundary
    .split(/[\s_\-.]+/)                             // split separators
    .map(t => t.toLowerCase())
    .filter(t => t.length > 1);
}

/**
 * Score how well `name` matches `queryTokens`.
 * Returns 0–1; 1 = every query token found.
 */
function score(name: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 1;  // empty query matches everything
  const toks = tokenise(name);
  let hits = 0;
  for (const qt of queryTokens) {
    if (toks.some(ft => ft.includes(qt) || qt.includes(ft))) hits++;
  }
  return hits / queryTokens.length;
}

interface Match {
  path:  string;
  name:  string;
  score: number;
  mtime: number;
}

/**
 * System directories that are ALWAYS skipped — in both the clean pass and
 * the junk-fallback pass.  Searching these could surface OS internals and
 * would never produce meaningful user files.
 */
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

function isSystem(name: string): boolean {
  return SYSTEM_DIRS.has(name.toLowerCase());
}

/** Directories that should be skipped unless skipJunk is false (last-resort pass). */
const JUNK_DIRS = new Set([
  '$recycle.bin',
  '$recycler',
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.tmp',
  'temp',
  'thumbs.db',
]);

function isJunk(name: string): boolean {
  return JUNK_DIRS.has(name.toLowerCase()) || name.startsWith('$') || name.startsWith('.');
}

function walk(
  dir: string,
  queryTokens: string[],
  allowedExts: Set<string> | null,
  folderHintTokens: string[] | null,
  depth: number,
  results: Match[],
  insideMatchingFolder: boolean,
  skipJunk: boolean,
): void {
  if (depth > MAX_DEPTH) return;

  let entries: import('node:fs').Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as import('node:fs').Dirent<string>[];
  } catch {
    return;
  }

  for (const e of entries) {
    const name = String(e.name);
    const full = join(dir, name);

    if (e.isDirectory()) {
      // Always skip protected system directories
      if (isSystem(name)) continue;
      // Skip junk directories on the clean pass
      if (skipJunk && isJunk(name)) continue;
      // Does this subfolder name match the hint?
      const thisMatches = folderHintTokens ? score(name, folderHintTokens) >= 0.5 : false;
      walk(full, queryTokens, allowedExts, folderHintTokens, depth + 1, results,
        insideMatchingFolder || thisMatches, skipJunk);
      continue;
    }

    // Only collect files if we're inside a matching folder (or no hint required)
    if (folderHintTokens && !insideMatchingFolder) continue;

    // Extension filter
    if (allowedExts && !allowedExts.has(extname(name).toLowerCase())) continue;

    // File name score (empty queryTokens → score 1 = any file qualifies)
    const s = score(name, queryTokens);
    if (s > 0) {
      let mtime = 0;
      try { mtime = statSync(full).mtimeMs; } catch { /* ignore */ }
      results.push({ path: full, name, score: s, mtime });
    }
  }
}

// ── Tool ──────────────────────────────────────────────────────────────────────

/**
 * Fuzzy recursive file search.
 *
 * Args:
 *   query?        — words to look for in the filename (can be empty string to match all)
 *   folder_hint?  — name of the parent folder to search inside (e.g. "OOPS", "sem3")
 *   dir?          — folder alias or absolute path to search inside (default: all common folders)
 *   extensions?   — array of extensions to restrict results (e.g. [".mp4", ".pdf"])
 *   sort_by?      — "score" (default) or "recent" (sorts by last-modified date, newest first)
 *   max_results?  — max hits to return (default 8)
 */
export async function findFile(args: Record<string, unknown>): Promise<string> {
  const query      = String(args['query']       ?? '').trim();
  const folderHint = String(args['folder_hint'] ?? '').trim();
  const dirArg     = args['dir']         != null ? String(args['dir'])             : null;
  const sortBy     = String(args['sort_by']     ?? 'score').trim();
  const maxResults = typeof args['max_results'] === 'number' ? args['max_results'] : MAX_RESULTS;
  const rawExts    = Array.isArray(args['extensions']) ? args['extensions'] as string[] : null;

  const allowedExts: Set<string> | null = rawExts
    ? new Set(rawExts.map(e => e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`))
    : null;

  const queryTokens      = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  const folderHintTokens = folderHint.length > 0
    ? folderHint.toLowerCase().split(/\s+/).filter(t => t.length > 0)
    : null;

  // Resolve search directories
  const searchDirs: string[] = dirArg
    ? [resolvePath(dirArg)]
    : DEFAULT_DIRS.flatMap(d => {
        try {
          const p = resolvePath(d);
          return existsSync(p) ? [p] : [];
        } catch { return []; }
      });

  if (searchDirs.length === 0) return `No accessible search directories found.`;

  // ── Pass 1: clean walk — skip Recycle Bin, node_modules, dotfiles, etc. ──
  const results: Match[] = [];
  for (const dir of searchDirs) {
    const rootMatches = folderHintTokens
      ? score(basename(dir), folderHintTokens) >= 0.5
      : false;
    walk(dir, queryTokens, allowedExts, folderHintTokens, 0, results, rootMatches, true);
  }

  // ── Pass 2: fallback — include junk dirs only if nothing found in pass 1 ──
  if (results.length === 0) {
    for (const dir of searchDirs) {
      const rootMatches = folderHintTokens
        ? score(basename(dir), folderHintTokens) >= 0.5
        : false;
      walk(dir, queryTokens, allowedExts, folderHintTokens, 0, results, rootMatches, false);
    }
  }

  // Sort
  if (sortBy === 'recent') {
    results.sort((a, b) => b.mtime - a.mtime);
  } else {
    results.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
  }

  // Deduplicate by full path
  const seen  = new Set<string>();
  const unique = results.filter(r => {
    if (seen.has(r.path)) return false;
    seen.add(r.path);
    return true;
  });

  const top = unique.slice(0, maxResults);

  if (top.length === 0) {
    const hint    = folderHint ? ` inside folder "${folderHint}"` : '';
    const extNote = rawExts    ? ` (${rawExts.join(', ')})` : '';
    return `No files found matching "${query || '*'}"${hint}${extNote}.`;
  }

  const lines = top.map((r, i) => `  ${i + 1}. ${r.name}\n     Full path: ${r.path}`);
  const hint  = folderHint ? ` inside folder "${folderHint}"` : '';
  return `Found ${top.length} result(s) for "${query || '*'}"${hint}:\n${lines.join('\n')}`;
}
