import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MemoryStore } from './store.js';

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const trimmed = raw.trim();
    return trimmed.length ? trimmed : null;
  } catch {
    return null;
  }
}

/** Loads optional project and memory context for each run. */
export class ContextLoader {
  private memory: MemoryStore;

  constructor(memoryStore?: MemoryStore) {
    this.memory = memoryStore ?? new MemoryStore();
  }

  async load(currentGoal: string): Promise<string> {
    const candidates = [
      resolve(process.cwd(), 'FELLA.md'),
      resolve(process.cwd(), 'GUIDE.md'),
      resolve(process.cwd(), '..', 'FELLA.md'),
      resolve(process.cwd(), '..', 'GUIDE.md'),
    ];

    let guideContext = '';
    for (const filePath of candidates) {
      const content = await readIfExists(filePath);
      if (content) {
        guideContext = content.slice(0, 4000);
        break;
      }
    }

    const recalled = this.memory.recall(currentGoal, 5);
    const memoryContext = recalled.length
      ? recalled
          .map((entry, idx) => `${idx + 1}. [${entry.timestamp}] ${entry.goal}`)
          .join('\n')
      : '';

    const facts = this.memory.getFacts();
    const factsContext = facts.length
      ? facts.map((fact, idx) => `${idx + 1}. ${fact}`).join('\n')
      : '';

    const parts: string[] = [];
    if (guideContext) parts.push(`Project guide:\n${guideContext}`);
    if (factsContext) parts.push(`Known persistent facts:\n${factsContext}`);
    if (memoryContext) parts.push(`Relevant past actions:\n${memoryContext}`);

    return parts.join('\n\n').trim();
  }
}
