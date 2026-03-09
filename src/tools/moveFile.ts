// moveFile.ts — Move or rename a file / directory
import { rename, access }      from 'node:fs/promises';
import { mkdir }               from 'node:fs/promises';
import { existsSync }          from 'node:fs';
import { dirname }             from 'node:path';
import { resolvePath }         from '../security/pathGuard.js';

export async function moveFile(args: Record<string, unknown>): Promise<string> {
  const src          = String(args['source']        ?? '');
  const dest         = String(args['destination']   ?? '');
  const createParent = args['create_parent'] !== false; // default true

  if (!src)  throw new Error('moveFile: "source" argument is required');
  if (!dest) throw new Error('moveFile: "destination" argument is required');

  const resolvedSrc  = resolvePath(src);
  const resolvedDest = resolvePath(dest);

  await access(resolvedSrc); // throws ENOENT if source not found

  // Never silently overwrite
  if (existsSync(resolvedDest)) {
    throw new Error(`Destination already exists: ${resolvedDest}`);
  }

  if (createParent) {
    await mkdir(dirname(resolvedDest), { recursive: true });
  }

  await rename(resolvedSrc, resolvedDest);
  return `Moved: ${resolvedSrc}  =>  ${resolvedDest}`;
}
