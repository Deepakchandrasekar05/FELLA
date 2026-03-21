import { homedir } from 'node:os';

export type PlatformKind = 'windows' | 'macos' | 'linux';

export function getPlatformKind(): PlatformKind {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

export function defaultSearchRoots(): string[] {
  const roots = ['downloads', 'documents', 'desktop', 'videos', 'pictures', 'music'];
  if (getPlatformKind() === 'windows') roots.push('d:');
  return roots;
}

export function defaultNavigateAliases(): string[] {
  const common = [
    'downloads', 'download', 'documents', 'document', 'docs',
    'desktop', 'pictures', 'picture', 'photos', 'music',
    'videos', 'video', 'movies', 'temp', 'tmp', 'home',
    'appdata', 'localappdata',
  ];

  if (getPlatformKind() === 'windows') {
    return [
      ...common,
      'd:', 'droot',
      'recyclebin', 'trash', 'thispc', 'mycomputer', 'controlpanel', 'network',
    ];
  }

  if (getPlatformKind() === 'macos') {
    return [...common, 'applications', 'trash'];
  }

  return [...common, 'trash'];
}

export function currentUserHome(): string {
  return homedir();
}