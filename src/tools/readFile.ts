// readFile.ts — Read file contents
import { access, readFile as fsReadFile } from 'node:fs/promises';
import { resolvePath } from '../security/pathGuard.js';

export async function readFile(args: Record<string, unknown>): Promise<string> {
  const filePath = String(args['path'] ?? '');
  if (!filePath) throw new Error('readFile: "path" argument is required');

  const resolved = resolvePath(filePath);
  await access(resolved);
  const content = await fsReadFile(resolved, { encoding: 'utf8' });

  return `Contents of ${resolved}:\n${content}`;
}
