import { homedir } from 'node:os';

export function getPlatformKind() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

export function defaultSearchRoots() {
  const roots = ['downloads', 'documents', 'desktop', 'videos', 'pictures', 'music'];
  if (getPlatformKind() === 'windows') roots.push('d:');
  return roots;
}

export function defaultNavigateAliases() {
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

export function currentUserHome() {
  return homedir();
}
