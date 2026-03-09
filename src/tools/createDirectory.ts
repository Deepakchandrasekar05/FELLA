// createDirectory.ts — Create a new directory (recursive)
import { mkdir } from 'node:fs/promises';
import { resolvePath } from '../security/pathGuard.js';

export async function createDirectory(args: Record<string, unknown>): Promise<string> {
  const dirPath = String(args['path'] ?? '');
  if (!dirPath) throw new Error('createDirectory: "path" argument is required');

  const resolved = resolvePath(dirPath);
  await mkdir(resolved, { recursive: true });
  return `Created folder: ${resolved}`;
}
