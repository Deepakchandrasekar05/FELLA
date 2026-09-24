// server/tools/moveFile.js — Move or rename a file / directory
import { rename, access, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolvePath } from '../security/pathGuard.js';

export async function moveFile(args) {
  const src          = String(args['source'] ?? '');
  const dest         = String(args['destination'] ?? '');
  const createParent = args['create_parent'] !== false;

  if (!src)  throw new Error('moveFile: "source" argument is required');
  if (!dest) throw new Error('moveFile: "destination" argument is required');

  const resolvedSrc  = resolvePath(src);
  const resolvedDest = resolvePath(dest);

  await access(resolvedSrc);

  if (existsSync(resolvedDest)) {
    throw new Error(`Destination already exists: ${resolvedDest}`);
  }

  if (createParent) {
    await mkdir(dirname(resolvedDest), { recursive: true });
  }

  await rename(resolvedSrc, resolvedDest);
  return `Moved: ${resolvedSrc}  =>  ${resolvedDest}`;
}
