// organiseByRule.ts — Batch-organise files in a directory by type/category/date/size/extension

import * as fs   from 'node:fs';
import * as path from 'node:path';
import { resolvePath } from '../security/pathGuard.js';

// ── Type map ──────────────────────────────────────────────────────────────────

const TYPE_MAP: Record<string, string> = {
  // Images
  '.jpg': 'Images',  '.jpeg': 'Images', '.png': 'Images',  '.gif': 'Images',
  '.webp': 'Images', '.svg': 'Images',  '.heic': 'Images', '.raw': 'Images',
  '.bmp': 'Images',  '.tiff': 'Images',
  // Videos
  '.mp4': 'Videos',  '.mov': 'Videos',  '.avi': 'Videos',  '.mkv': 'Videos',
  '.wmv': 'Videos',  '.webm': 'Videos', '.flv': 'Videos',
  // Audio
  '.mp3': 'Audio',   '.wav': 'Audio',   '.flac': 'Audio',  '.aac': 'Audio',
  '.ogg': 'Audio',   '.m4a': 'Audio',   '.wma': 'Audio',
  // Documents
  '.pdf': 'Documents', '.doc': 'Documents', '.docx': 'Documents',
  '.txt': 'Documents', '.md': 'Documents',  '.odt': 'Documents', '.rtf': 'Documents',
  // Spreadsheets
  '.xls': 'Spreadsheets', '.xlsx': 'Spreadsheets', '.csv': 'Spreadsheets', '.ods': 'Spreadsheets',
  // Presentations
  '.ppt': 'Presentations', '.pptx': 'Presentations', '.odp': 'Presentations',
  // Archives
  '.zip': 'Archives', '.rar': 'Archives', '.7z': 'Archives',
  '.tar': 'Archives', '.gz': 'Archives',  '.bz2': 'Archives',
  // Code
  '.js': 'Code', '.ts': 'Code', '.py': 'Code',   '.java': 'Code',
  '.cpp': 'Code', '.c': 'Code', '.go': 'Code',   '.rs': 'Code',
  '.html': 'Code', '.css': 'Code', '.json': 'Code', '.xml': 'Code',
  // Installers
  '.exe': 'Installers', '.msi': 'Installers', '.dmg': 'Installers',
  '.deb': 'Installers', '.rpm': 'Installers',
};

function getTypeFolder(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return TYPE_MAP[ext] ?? 'Other';
}

// ── Category sets for by_category rule ───────────────────────────────────────

const CATEGORY_IMAGES = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
  '.heic', '.raw', '.bmp', '.tiff',
]);
const CATEGORY_VIDEOS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.wmv', '.webm', '.flv',
]);

function getCategoryFolder(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf')            return 'PDFs';
  if (CATEGORY_IMAGES.has(ext))  return 'Images';
  if (CATEGORY_VIDEOS.has(ext))  return 'Videos';
  return 'Other';
}

// ── Destination resolver ──────────────────────────────────────────────────────

function resolveDestFolder(
  filename: string,
  stat: fs.Stats,
  rule: string,
  baseDir: string,
): string {
  switch (rule) {
    case 'by_type':
      return path.join(baseDir, getTypeFolder(filename));

    case 'by_category':
      return path.join(baseDir, getCategoryFolder(filename));

    case 'by_extension': {
      const ext = path.extname(filename).slice(1).toUpperCase() || 'NO_EXTENSION';
      return path.join(baseDir, ext);
    }

    case 'by_date': {
      const year  = stat.mtime.getFullYear();
      const month = stat.mtime.toLocaleString('default', { month: 'long' });
      return path.join(baseDir, String(year), month);
    }

    case 'by_size': {
      const mb = stat.size / (1024 * 1024);
      const folder =
        mb < 1    ? 'Small (< 1 MB)'
        : mb < 100  ? 'Medium (1–100 MB)'
        : mb < 1024 ? 'Large (100 MB–1 GB)'
        :             'Huge (> 1 GB)';
      return path.join(baseDir, folder);
    }

    default:
      return baseDir;
  }
}

// ── Date-filter helper ───────────────────────────────────────────────────────

/**
 * Resolve a human-friendly "since" string to an absolute Date cut-off.
 * Accepts: last_week | last_month | last_3_months | last_year | ISO date string.
 * Returns null if the string cannot be parsed.
 */
export function resolveSinceDate(since: string): Date | null {
  const now = new Date();
  const MS_DAY = 24 * 60 * 60 * 1000;
  switch (since.toLowerCase()) {
    case 'last_week':     return new Date(now.getTime() -   7 * MS_DAY);
    case 'last_month':    return new Date(now.getTime() -  30 * MS_DAY);
    case 'last_3_months': return new Date(now.getTime() -  90 * MS_DAY);
    case 'last_year':     return new Date(now.getTime() - 365 * MS_DAY);
    default: {
      const d = new Date(since);
      return isNaN(d.getTime()) ? null : d;
    }
  }
}

// ── Plan builder ──────────────────────────────────────────────────────────────

export interface MovePlan {
  source:      string;
  destination: string;
  folder:      string;
}

/**
 * Build the list of moves for all files in sourceDir that match the rule.
 * @param since - Optional cut-off: only files modified on or after this date are included.
 */
export function buildPlan(sourceDir: string, rule: string, since?: Date): MovePlan[] {
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const plan: MovePlan[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const src  = path.join(sourceDir, entry.name);
    const stat = fs.statSync(src);
    // Apply date filter — skip files older than the cut-off
    if (since && stat.mtime < since) continue;
    const destDir = resolveDestFolder(entry.name, stat, rule, sourceDir);
    plan.push({
      source:      src,
      destination: path.join(destDir, entry.name),
      folder:      path.basename(destDir),
    });
  }

  return plan;
}

// ── Preview formatter ─────────────────────────────────────────────────────────

function formatPreview(plan: MovePlan[], sourceDir: string, since?: Date): string {
  if (plan.length === 0) {
    const sinceNote = since ? ` modified since ${since.toLocaleDateString()}` : '';
    return `No files${sinceNote} found in ${sourceDir}`;
  }

  // Group by destination folder
  const groups = new Map<string, { count: number; bytes: number }>();
  for (const item of plan) {
    const stat = fs.statSync(item.source);
    const g = groups.get(item.folder) ?? { count: 0, bytes: 0 };
    g.count++;
    g.bytes += stat.size;
    groups.set(item.folder, g);
  }

  const formatSize = (b: number): string => {
    if (b < 1024)           return `${b} B`;
    if (b < 1024 ** 2)      return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 ** 3)      return `${(b / 1024 ** 2).toFixed(1)} MB`;
    return `${(b / 1024 ** 3).toFixed(2)} GB`;
  };

  const sinceLabel = since ? ` · since ${since.toLocaleDateString()}` : '';
  const lines: string[] = [
    `ORGANISATION PREVIEW — ${plan.length} file${plan.length !== 1 ? 's' : ''} in ${sourceDir}${sinceLabel}`,
    '',
  ];

  for (const [folder, { count, bytes }] of groups) {
    lines.push(`  ${folder.padEnd(22)} ${String(count).padStart(4)} file${count !== 1 ? 's' : ' '}  (${formatSize(bytes)})`);
  }

  lines.push('', 'Type "yes" to execute or "no" to cancel.');
  return lines.join('\n');
}

// ── Plan executor ────────────────────────────────────────────────────────────

export interface PlanResult {
  moved:       number;
  skipped:     number;
  errors:      string[];
  /** Pairs that were actually renamed — used to build undo entries. */
  actualMoves: Array<{ source: string; destination: string }>;
}

/** Execute a pre-built plan and return counts plus the list of moves that succeeded. */
export function executePlan(plan: MovePlan[]): PlanResult {
  let moved = 0, skipped = 0;
  const errors:      string[]                                  = [];
  const actualMoves: Array<{ source: string; destination: string }> = [];

  for (const item of plan) {
    try {
      fs.mkdirSync(path.dirname(item.destination), { recursive: true });
      if (fs.existsSync(item.destination)) {
        skipped++;
        continue;
      }
      fs.renameSync(item.source, item.destination);
      moved++;
      actualMoves.push({ source: item.source, destination: item.destination });
    } catch (err) {
      errors.push(`${path.basename(item.source)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { moved, skipped, errors, actualMoves };
}

// ── Tool entry-point ──────────────────────────────────────────────────────────

export async function organiseByRule(args: Record<string, unknown>): Promise<string> {
  const rawDir   = String(args['source_dir'] ?? '');
  const rule     = String(args['rule']       ?? 'by_type');
  const dryRun   = args['dry_run'] !== false; // default to dry-run for safety
  const sinceRaw = args['since'] != null ? String(args['since']) : null;

  if (!rawDir) throw new Error('organiseByRule: "source_dir" argument is required');

  let since: Date | undefined;
  if (sinceRaw) {
    const resolved = resolveSinceDate(sinceRaw);
    if (!resolved) throw new Error(`organiseByRule: invalid "since" value: "${sinceRaw}"`);
    since = resolved;
  }

  const sourceDir = resolvePath(rawDir);
  const plan      = buildPlan(sourceDir, rule, since);

  if (dryRun) {
    return formatPreview(plan, sourceDir, since);
  }

  const { moved, skipped, errors } = executePlan(plan);

  const parts = [`Moved ${moved} of ${plan.length} files`];
  if (skipped) parts.push(`${skipped} skipped (already exist)`);
  if (errors.length) parts.push(`${errors.length} error(s):\n  ${errors.join('\n  ')}`);
  return parts.join('\n');
}
