// writeFile.ts — Write or append text content to a file
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolvePath } from '../security/pathGuard.js';

export async function writeFileTool(args: Record<string, unknown>): Promise<string> {
  const filePath = String(args['path'] ?? '');
  const content = String(args['content'] ?? '');
  const append = args['append'] === true;

  if (!filePath) throw new Error('writeFile: "path" argument is required');

  const resolved = resolvePath(filePath);
  await mkdir(dirname(resolved), { recursive: true });

  if (append) {
    await appendFile(resolved, content, { encoding: 'utf8' });
    return `Appended content to: ${resolved}`;
  }

  await writeFile(resolved, content, { encoding: 'utf8', flag: 'w' });
  return `Written content to: ${resolved}`;
}

export { writeFileTool as writeFile };
