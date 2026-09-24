// server/tools/deleteFile.js — Delete a file or directory
import { rm, access } from 'node:fs/promises';
import { resolvePath } from '../security/pathGuard.js';

export async function deleteFile(args) {
  const filePath = String(args['path'] ?? '');
  if (!filePath) throw new Error('deleteFile: "path" argument is required');

  const resolved = resolvePath(filePath);
  await access(resolved);
  await rm(resolved, { recursive: true, force: true });
  return `Deleted: ${resolved}`;
}
