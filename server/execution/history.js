// server/execution/history.js — Undo / Redo stack for reversible file operations

export class UndoStack {
  constructor() {
    this.past = [];
    this.future = [];
  }

  push(entry) {
    this.past.push(entry);
    this.future = [];
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  async undo() {
    const entry = this.past.pop();
    if (!entry) return 'Nothing to undo.';
    try {
      await entry.undo();
    } catch (err) {
      this.past.push(entry);
      throw err;
    }
    this.future.push(entry);
    return `Undone: ${entry.description}`;
  }

  async redo() {
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

  clear() {
    this.past = [];
    this.future = [];
  }
}
