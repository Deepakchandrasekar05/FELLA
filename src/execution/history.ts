// history.ts — Undo / Redo stack for reversible file operations

export interface HistoryEntry {
  /** Human-readable description shown in undo/redo messages. */
  description: string;
  /** Reverse the operation. */
  undo: () => Promise<void>;
  /** Re-apply the operation after it was undone. */
  redo: () => Promise<void>;
}

/**
 * Two-stack undo/redo manager.
 *
 * - `push(entry)` — record a new reversible action; clears the redo stack.
 * - `undo()`      — revert the most recent action and shift it to the redo stack.
 * - `redo()`      — re-apply the most recently undone action.
 * - `clear()`     — wipe both stacks (used on session reset).
 */
export class UndoStack {
  private past:   HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  /** Record a new reversible action. Invalidates the redo stack. */
  push(entry: HistoryEntry): void {
    this.past.push(entry);
    this.future = [];
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  /**
   * Undo the most recent action.
   * @returns A human-readable confirmation string.
   * @throws  If the undo operation itself fails (entry is NOT moved to future).
   */
  async undo(): Promise<string> {
    const entry = this.past.pop();
    if (!entry) return 'Nothing to undo.';
    try {
      await entry.undo();
    } catch (err) {
      // Restore the entry so the user can retry or inspect state
      this.past.push(entry);
      throw err;
    }
    this.future.push(entry);
    return `Undone: ${entry.description}`;
  }

  /**
   * Redo the most recently undone action.
   * @returns A human-readable confirmation string.
   * @throws  If the redo operation itself fails (entry is NOT moved back to past).
   */
  async redo(): Promise<string> {
    const entry = this.future.pop();
    if (!entry) return 'Nothing to redo.';
    try {
      await entry.redo();
    } catch (err) {
      this.future.push(entry);
      throw err;
    }
    this.past.push(entry);
    return `Redone: ${entry.description}`;
  }

  /** Clear both stacks — call on session reset. */
  clear(): void {
    this.past   = [];
    this.future = [];
  }
}
