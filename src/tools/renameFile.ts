// renameFile.ts — Rename a file in place
import { access, rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { resolvePath } from '../security/pathGuard.js';

export async function renameFile(args: Record<string, unknown>): Promise<string> {
  const filePath = String(args['path'] ?? '');
  const newName = String(args['newName'] ?? '');

  if (!filePath) throw new Error('renameFile: "path" argument is required');
  if (!newName) throw new Error('renameFile: "newName" argument is required');

  const resolved = resolvePath(filePath);
  const target = resolvePath(join(dirname(resolved), newName));

  await access(resolved);
  await rename(resolved, target);

  return `Renamed ${basename(resolved)} to ${basename(target)} (${target})`;
}
