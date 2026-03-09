// pathGuard.ts — Path resolution: well-known aliases + relative → absolute

import { homedir } from 'node:os';
import { resolve, isAbsolute, join, normalize } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Ask Windows for the real Shell special-folder path at startup (synchronous,
 * one-shot).  This correctly handles OneDrive-redirected Desktop/Documents/etc.
 * Returns undefined if PowerShell is unavailable (non-Windows or SEA bundle
 * without shell access).
 */
function winShellFolder(name: string): string | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    const out = execSync(
      `powershell.exe -NoProfile -NonInteractive -Command "[Environment]::GetFolderPath('${name}')"`,
      { encoding: 'utf8', timeout: 3000 },
    ).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the Downloads folder on Windows via the User Shell Folders registry
 * key (GUID {374DE290-123F-4565-9164-39C4925E467B}).  This correctly returns
 * the OneDrive-redirected path when applicable, unlike [Environment]::GetFolderPath
 * which has no SpecialFolder enum entry for Downloads.
 */
function winDownloadsFolder(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    const out = execSync(
      `powershell.exe -NoProfile -NonInteractive -Command ` +
      `"(New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path"`,
      { encoding: 'utf8', timeout: 3000 },
    ).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

// ── Well-known folder aliases ─────────────────────────────────────────────────

const home = homedir();

// Resolve Windows Shell special folders at startup so OneDrive-redirected
// paths (Desktop, Documents, Pictures, Music, Videos) are always correct.
const realDesktop   = winShellFolder('Desktop')   ?? join(home, 'Desktop');
const realDocuments = winShellFolder('MyDocuments') ?? join(home, 'Documents');
const realPictures  = winShellFolder('MyPictures') ?? join(home, 'Pictures');
const realMusic     = winShellFolder('MyMusic')    ?? join(home, 'Music');
const realVideos    = winShellFolder('MyVideos')   ?? join(home, 'Videos');
const realDownloads = winDownloadsFolder() ?? join(home, 'Downloads');

/**
 * Maps common natural-language folder names (as the model may emit them) to
 * their absolute Windows paths.  Keys are lowercased and stripped of spaces.
 *
 * ACCESS POLICY
 * ─────────────
 * C drive  : only paths under C:\Users\ are permitted.
 * D drive  : full access — any path under D:\ is allowed.
 * Other    : blocked.
 */
const KNOWN_FOLDERS: Record<string, string> = {
  // ── User folders (all resolve inside C:\Users\<name>\) ─────────────────────
  home,
  '~': home,
  downloads:    realDownloads,
  download:     realDownloads,
  documents:    realDocuments,
  document:     realDocuments,
  docs:         realDocuments,
  desktop:      realDesktop,
  pictures:     realPictures,
  picture:      realPictures,
  photos:       realPictures,
  music:        realMusic,
  videos:       realVideos,
  video:        realVideos,
  movies:       realVideos,
  temp:         process.env['TEMP'] ?? join(home, 'AppData', 'Local', 'Temp'),
  tmp:          process.env['TEMP'] ?? join(home, 'AppData', 'Local', 'Temp'),
  appdata:      join(home, 'AppData', 'Roaming'),
  localappdata: join(home, 'AppData', 'Local'),
  // ── D drive ─────────────────────────────────────────────────────────────────
  'd:':         'D:\\',
  'd:\\':       'D:\\',
  droot:        'D:\\',
};

// ── Access policy ─────────────────────────────────────────────────────────────

/**
 * Throws if the resolved absolute path is not within an allowed zone:
 *   • C:\Users\  (the current user tree, and their Temp)
 *   • D:\        (entire D drive)
 */
export function assertAllowed(absPath: string): void {
  const norm  = normalize(absPath).toUpperCase();
  const cUser = normalize('C:\\Users\\').toUpperCase();
  const dRoot = normalize('D:\\').toUpperCase();

  if (norm.startsWith(dRoot)) return;       // D drive — always allowed
  if (norm.startsWith(cUser)) return;       // C:\Users\... — allowed

  throw new Error(
    `Access denied: "${absPath}" is outside the allowed zones.\n` +
    `Allowed: C:\\Users\\ (user data) and D:\\ (entire D drive).`,
  );
}

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * Resolve a raw path string supplied by the model into a safe absolute path,
 * then verify it falls within the allowed zones before returning it.
 *
 * Resolution order:
 * 1. Well-known alias (e.g. "downloads", "desktop") → mapped absolute path
 * 2. Absolute path                                   → normalised as-is
 * 3. Relative path                                   → resolved from home dir
 */
export function resolvePath(raw: string): string {
  const trimmed = raw.trim();

  // 1. Alias lookup — normalise to lowercase, collapse spaces/underscores
  const key = trimmed.toLowerCase().replace(/[\s_-]+/g, '');
  let resolved: string;
  if (Object.prototype.hasOwnProperty.call(KNOWN_FOLDERS, key)) {
    resolved = KNOWN_FOLDERS[key]!;
  } else {
    // 1b. Alias prefix — e.g. "desktop/Test" or "downloads\file.txt"
    //     Split on the first separator, resolve the leading part as an alias,
    //     then join the remainder.  Without this, "desktop/Test" would fall
    //     through to the relative-path branch and produce
    //     C:\Users\<name>\desktop\Test (lowercase, wrong OneDrive path).
    const sepIdx = trimmed.search(/[/\\]/);
    const aliasKey = sepIdx !== -1
      ? trimmed.slice(0, sepIdx).toLowerCase().replace(/[\s_-]+/g, '')
      : '';

    if (aliasKey && Object.prototype.hasOwnProperty.call(KNOWN_FOLDERS, aliasKey)) {
      resolved = join(KNOWN_FOLDERS[aliasKey]!, trimmed.slice(sepIdx + 1));
    } else if (isAbsolute(trimmed)) {
      // 2. Absolute path — normalise as-is
      resolved = resolve(trimmed);
    } else {
      // 3. Relative — resolve from home dir
      resolved = resolve(join(home, trimmed));
    }
  }

  assertAllowed(resolved);
  return resolved;
}
