// pathGuard.ts - Cross-platform path resolution and safety policy

import { homedir, tmpdir } from 'node:os';
import { resolve, isAbsolute, join, normalize } from 'node:path';
import { execSync } from 'node:child_process';

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

function winDownloadsFolder(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    const out = execSync(
      "powershell.exe -NoProfile -NonInteractive -Command \"(New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path\"",
      { encoding: 'utf8', timeout: 3000 },
    ).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

const home = homedir();
const tmp = tmpdir();

const knownFolders: Record<string, string> = (() => {
  const base: Record<string, string> = {
    home,
    '~': home,
    downloads: join(home, 'Downloads'),
    download: join(home, 'Downloads'),
    documents: join(home, 'Documents'),
    document: join(home, 'Documents'),
    docs: join(home, 'Documents'),
    desktop: join(home, 'Desktop'),
    pictures: join(home, 'Pictures'),
    picture: join(home, 'Pictures'),
    photos: join(home, 'Pictures'),
    music: join(home, 'Music'),
    videos: join(home, 'Videos'),
    video: join(home, 'Videos'),
    movies: join(home, 'Videos'),
    temp: tmp,
    tmp,
  };

  if (process.platform === 'win32') {
    base['desktop'] = winShellFolder('Desktop') ?? base['desktop']!;
    base['documents'] = winShellFolder('MyDocuments') ?? base['documents']!;
    base['document'] = base['documents']!;
    base['docs'] = base['documents']!;
    base['pictures'] = winShellFolder('MyPictures') ?? base['pictures']!;
    base['picture'] = base['pictures']!;
    base['photos'] = base['pictures']!;
    base['music'] = winShellFolder('MyMusic') ?? base['music']!;
    base['videos'] = winShellFolder('MyVideos') ?? base['videos']!;
    base['video'] = base['videos']!;
    base['movies'] = base['videos']!;
    base['downloads'] = winDownloadsFolder() ?? base['downloads']!;
    base['download'] = base['downloads']!;
    base['appdata'] = join(home, 'AppData', 'Roaming');
    base['localappdata'] = join(home, 'AppData', 'Local');
    base['d:'] = 'D:\\';
    base['d:\\'] = 'D:\\';
    base['droot'] = 'D:\\';
  } else if (process.platform === 'darwin') {
    base['appdata'] = join(home, 'Library', 'Application Support');
    base['localappdata'] = join(home, 'Library', 'Application Support');
    base['applications'] = '/Applications';
    base['trash'] = join(home, '.Trash');
  } else {
    base['appdata'] = process.env['XDG_CONFIG_HOME'] ?? join(home, '.config');
    base['localappdata'] = process.env['XDG_DATA_HOME'] ?? join(home, '.local', 'share');
    base['trash'] = join(home, '.local', 'share', 'Trash');
  }

  return base;
})();

function isPathInside(absPath: string, root: string): boolean {
  const resolvedPath = normalize(resolve(absPath));
  const resolvedRoot = normalize(resolve(root));
  if (process.platform === 'win32') {
    const p = resolvedPath.toUpperCase().replace(/[\\/]+$/, '');
    const r = resolvedRoot.toUpperCase().replace(/[\\/]+$/, '');
    return p === r || p.startsWith(`${r}\\`) || p.startsWith(`${r}/`);
  }
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}/`);
}

function assertAllowedWindows(absPath: string): void {
  const blocked = [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
    'C:\\System Volume Information',
    'C:\\Recovery',
    'C:\\Boot',
    'C:\\EFI',
  ];

  for (const dir of blocked) {
    if (isPathInside(absPath, dir)) {
      throw new Error(
        `Access denied: "${absPath}" is a protected system path on Windows.`,
      );
    }
  }

  const allowedRoots = ['C:\\Users', 'D:\\'];
  if (allowedRoots.some((root) => isPathInside(absPath, root))) return;

  throw new Error(
    `Access denied: "${absPath}" is outside allowed zones. Allowed: C:\\Users and D:\\`,
  );
}

function assertAllowedMac(absPath: string): void {
  const blockedPrefixes = ['/System', '/Library', '/private/var/root', '/usr', '/bin', '/sbin'];
  if (blockedPrefixes.some((p) => isPathInside(absPath, p))) {
    throw new Error(`Access denied: "${absPath}" is a protected macOS system path.`);
  }

  const allowedRoots = [home, '/Volumes', tmp];
  if (allowedRoots.some((root) => isPathInside(absPath, root))) return;

  throw new Error(
    `Access denied: "${absPath}" is outside allowed zones. Allowed: ${home}, /Volumes, ${tmp}`,
  );
}

function assertAllowedLinux(absPath: string): void {
  const blockedPrefixes = ['/bin', '/sbin', '/usr', '/lib', '/lib64', '/etc', '/proc', '/sys', '/dev', '/boot'];
  if (blockedPrefixes.some((p) => isPathInside(absPath, p))) {
    throw new Error(`Access denied: "${absPath}" is a protected Linux system path.`);
  }

  const allowedRoots = [home, '/media', '/mnt', tmp];
  if (allowedRoots.some((root) => isPathInside(absPath, root))) return;

  throw new Error(
    `Access denied: "${absPath}" is outside allowed zones. Allowed: ${home}, /media, /mnt, ${tmp}`,
  );
}

export function assertAllowed(absPath: string): void {
  if (process.platform === 'win32') {
    assertAllowedWindows(absPath);
    return;
  }
  if (process.platform === 'darwin') {
    assertAllowedMac(absPath);
    return;
  }
  assertAllowedLinux(absPath);
}

export function resolvePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Path cannot be empty.');

  const key = trimmed.toLowerCase().replace(/[\s_-]+/g, '');
  let resolvedPath: string;

  if (Object.prototype.hasOwnProperty.call(knownFolders, key)) {
    resolvedPath = knownFolders[key]!;
  } else {
    const sepIdx = trimmed.search(/[\\/]/);
    const aliasKey = sepIdx !== -1
      ? trimmed.slice(0, sepIdx).toLowerCase().replace(/[\s_-]+/g, '')
      : '';

    if (aliasKey && Object.prototype.hasOwnProperty.call(knownFolders, aliasKey)) {
      resolvedPath = join(knownFolders[aliasKey]!, trimmed.slice(sepIdx + 1));
    } else if (isAbsolute(trimmed)) {
      resolvedPath = resolve(trimmed);
    } else {
      resolvedPath = resolve(join(home, trimmed));
    }
  }

  assertAllowed(resolvedPath);
  return resolvedPath;
}
