// server/tools/findFile.js — Fuzzy recursive file/folder search
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { resolvePath } from '../security/pathGuard.js';
import { defaultSearchRoots } from '../platform/runtime.js';

const MAX_DEPTH = 8;
const MAX_RESULTS = 8;
const QUERY_STOPWORDS = new Set([
  'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'from', 'of', 'and',
  'it', 'this', 'that', 'using', 'with', 'open', 'play', 'use',
]);

const DEFAULT_DIRS = defaultSearchRoots();

function tokenise(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1);
}

function queryTokensFrom(raw) {
  const base = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]+/g, ' ')
    .split(/[\s_-]+/)
    .filter((t) => t.length > 0);

  const filtered = base.filter((t) => !QUERY_STOPWORDS.has(t));
  return filtered.length > 0 ? filtered : base;
}

function score(name, queryTokens) {
  if (queryTokens.length === 0) return 1;
  const toks = tokenise(name);
  let hits = 0;
  for (const qt of queryTokens) {
    if (toks.some((ft) => ft.includes(qt) || qt.includes(ft))) hits++;
  }
  return hits / queryTokens.length;
}

function isStrongEnoughScore(s, queryTokenCount) {
  if (queryTokenCount <= 1) return s > 0;
  if (queryTokenCount === 2) return s >= 0.5;
  return s >= 0.4;
}

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

function isSystem(name) {
  return SYSTEM_DIRS.has(name.toLowerCase());
}

const JUNK_DIRS = new Set([
  '$recycle.bin',
  '$recycler',
  'node_modules',
  'venv',
  '.venv',
  '__pycache__',
  'site-packages',
  '.git',
  '.svn',
  '.hg',
  '.tmp',
  'temp',
  'thumbs.db',
]);

function isJunk(name) {
  return JUNK_DIRS.has(name.toLowerCase()) || name.startsWith('$') || name.startsWith('.');
}

function folderHintMatches(name, hintTokens) {
  if (hintTokens.length === 0) return true;
  const folderTokens = tokenise(name);
  return hintTokens.every((hint) =>
    folderTokens.some((folderToken) =>
      folderToken === hint || folderToken.startsWith(hint) || hint.startsWith(folderToken + 's'),
    ),
  );
}

function walk(
  dir,
  queryTokens,
  allowedExts,
  folderHintTokens,
  depth,
  results,
  insideMatchingFolder,
  skipJunk,
) {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    const name = String(e.name);
    const full = join(dir, name);

    if (e.isDirectory()) {
      if (isSystem(name)) continue;
      if (skipJunk && isJunk(name)) continue;
      const thisMatches = folderHintTokens ? folderHintMatches(name, folderHintTokens) : false;
      walk(full, queryTokens, allowedExts, folderHintTokens, depth + 1, results,
        insideMatchingFolder || thisMatches, skipJunk);
      continue;
    }

    if (folderHintTokens && !insideMatchingFolder) continue;
    if (allowedExts && !allowedExts.has(extname(name).toLowerCase())) continue;

    const s = score(name, queryTokens);
    if (isStrongEnoughScore(s, queryTokens.length)) {
      let mtime = 0;
      try { mtime = statSync(full).mtimeMs; } catch { /* ignore */ }
      results.push({ path: full, name, score: s, mtime });
    }
  }
}

function walkFoldersByName(dir, queryTokens, depth, results, skipJunk) {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    if (!e.isDirectory()) continue;

    const name = String(e.name);
    if (isSystem(name)) continue;
    if (skipJunk && isJunk(name)) continue;

    const full = join(dir, name);
    const s = score(name, queryTokens);
    if (s > 0) {
      results.push({ path: full, name, score: s });
    }

    walkFoldersByName(full, queryTokens, depth + 1, results, skipJunk);
  }
}

export async function findFile(args) {
  const queryLike = args['query'] ?? args['pattern'] ?? '';
  const query      = String(queryLike === '*' ? '' : queryLike).trim();
  const folderHint = String(args['folder_hint'] ?? args['folder_name'] ?? '').trim();
  const dirArgRaw  = args['dir'] ?? args['path'] ?? args['search_path'] ?? null;
  const dirArg     = dirArgRaw != null ? String(dirArgRaw) : null;
  const sortBy     = String(args['sort_by'] ?? 'score').trim();
  const maxResults = typeof args['max_results'] === 'number' ? args['max_results'] : MAX_RESULTS;
  const rawExts    = Array.isArray(args['extensions']) ? args['extensions'] : null;

  const allowedExts = rawExts
    ? new Set(rawExts.map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`)))
    : null;

  const queryTokens      = queryTokensFrom(query);
  const folderHintTokens = folderHint.length > 0
    ? folderHint.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
    : null;

  const searchDirs = dirArg
    ? [resolvePath(dirArg)]
    : DEFAULT_DIRS.flatMap((d) => {
        try {
          const p = resolvePath(d);
          return existsSync(p) ? [p] : [];
        } catch { return []; }
      });

  if (searchDirs.length === 0) return `No accessible search directories found.`;

  const results = [];
  for (const dir of searchDirs) {
    const rootMatches = folderHintTokens
      ? folderHintMatches(basename(dir), folderHintTokens)
      : false;
    walk(dir, queryTokens, allowedExts, folderHintTokens, 0, results, rootMatches, true);
  }

  if (results.length === 0) {
    for (const dir of searchDirs) {
      const rootMatches = folderHintTokens
        ? folderHintMatches(basename(dir), folderHintTokens)
        : false;
      walk(dir, queryTokens, allowedExts, folderHintTokens, 0, results, rootMatches, false);
    }
  }

  if (sortBy === 'recent') {
    results.sort((a, b) => b.mtime - a.mtime);
  } else {
    results.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
  }

  const seen = new Set();
  const unique = results.filter((r) => {
    if (seen.has(r.path)) return false;
    seen.add(r.path);
    return true;
  });

  const top = unique.slice(0, maxResults);

  if (top.length === 0) {
    const folderResults = [];
    for (const dir of searchDirs) {
      walkFoldersByName(dir, queryTokens, 0, folderResults, true);
    }

    if (folderResults.length === 0) {
      for (const dir of searchDirs) {
        walkFoldersByName(dir, queryTokens, 0, folderResults, false);
      }
    }

    folderResults.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
    const folderSeen = new Set();
    const topFolders = folderResults.filter((r) => {
      if (folderSeen.has(r.path)) return false;
      folderSeen.add(r.path);
      return true;
    }).slice(0, maxResults);

    const hint    = folderHint ? ` inside folder "${folderHint}"` : '';
    const extNote = rawExts    ? ` (${rawExts.join(', ')})` : '';
    if (topFolders.length === 0) {
      return `No files found matching "${query || '*'}"${hint}${extNote}.`;
    }

    const folderLines = topFolders.map((r, i) => `  ${i + 1}. ${r.name}\n     Full path: ${r.path}`);
    return `No files found matching "${query || '*'}"${hint}${extNote}.\nFound ${topFolders.length} folder match(es) for "${query || '*'}":\n${folderLines.join('\n')}`;
  }

  const lines = top.map((r, i) => `  ${i + 1}. ${r.name}\n     Full path: ${r.path}`);
  const hint  = folderHint ? ` inside folder "${folderHint}"` : '';
  return `Found ${top.length} result(s) for "${query || '*'}"${hint}:\n${lines.join('\n')}`;
}
