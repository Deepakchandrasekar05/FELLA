// deleteFile.ts — Delete a file or directory
import { rm, access } from 'node:fs/promises';
import { resolvePath } from '../security/pathGuard.js';

export async function deleteFile(args: Record<string, unknown>): Promise<string> {
  const filePath = String(args['path'] ?? '');
  if (!filePath) throw new Error('deleteFile: "path" argument is required');

  const resolved = resolvePath(filePath);
  await access(resolved); // throws if not found
  await rm(resolved, { recursive: true, force: true });
  return `Deleted: ${resolved}`;
}
