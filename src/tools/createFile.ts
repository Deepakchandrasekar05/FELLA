// createFile.ts — Create a new empty file
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolvePath } from '../security/pathGuard.js';

export async function createFile(args: Record<string, unknown>): Promise<string> {
  const filePath = String(args['path'] ?? '');
  if (!filePath) throw new Error('createFile: "path" argument is required');

  const resolved = resolvePath(filePath);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, '', { encoding: 'utf8', flag: 'w' });

  return `Created file: ${resolved}`;
}
