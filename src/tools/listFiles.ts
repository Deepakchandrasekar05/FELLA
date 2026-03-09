// listFiles.ts — List the contents of a directory
import { readdir } from 'node:fs/promises';
import { resolvePath } from '../security/pathGuard.js';

export async function listFiles(args: Record<string, unknown>): Promise<string> {
  const dirPath = String(args['path'] ?? '');
  if (!dirPath) throw new Error('listFiles: "path" argument is required');

  const resolved = resolvePath(dirPath);
  const entries = await readdir(resolved, { withFileTypes: true });

  if (entries.length === 0) return `(empty) ${resolved}`;

  const lines = entries.map(
    (e) => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`,
  );
  return `Contents of ${resolved}:\n${lines.join('\n')}`;
}
