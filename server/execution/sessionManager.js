// server/execution/sessionManager.js — In-memory registry for session Engine instances
import { Engine } from './engine.js';
import { MemoryStore } from '../memory/store.js';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

class SessionEngineManager {
  constructor() {
    /** @type {Map<string, { engine: Engine, lastAccessedAt: number }>} */
    this.sessions = new Map();
    this.store = new MemoryStore();

    // Periodic sweep for idle sessions every 5 minutes
    this.sweepInterval = setInterval(() => this.sweepIdleSessions(), 5 * 60 * 1000);
    if (this.sweepInterval.unref) {
      this.sweepInterval.unref();
    }
  }

  /**
   * Get an existing Engine instance or create/resume one.
   * @param {string} [sessionId] - Optional session ID to resume or assign
   * @returns {Engine}
   */
  getOrCreateEngine(sessionId) {
    const now = Date.now();

    if (sessionId && this.sessions.has(sessionId)) {
      const entry = this.sessions.get(sessionId);
      entry.lastAccessedAt = now;
      return entry.engine;
    }

    // Check if session exists in persistent store
    const resumeId = sessionId && this.store.sessionExists(sessionId) ? sessionId : sessionId;
    const engine = new Engine(resumeId);
    const assignedId = engine.id;

    this.sessions.set(assignedId, {
      engine,
      lastAccessedAt: now,
    });

    return engine;
  }

  /**
   * Access an existing in-memory engine without creating one if absent.
   * @param {string} sessionId
   * @returns {Engine | null}
   */
  getEngine(sessionId) {
    if (!sessionId) return null;
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.lastAccessedAt = Date.now();
      return entry.engine;
    }
    return null;
  }

  /**
   * Remove an engine from memory (e.g. when deleted or reset).
   * @param {string} sessionId
   */
  deleteEngine(sessionId) {
    if (sessionId) {
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Evict idle sessions from memory to prevent memory bloat.
   * Turns remain safely in SQLite.
   */
  sweepIdleSessions() {
    const now = Date.now();
    for (const [id, entry] of this.sessions.entries()) {
      if (now - entry.lastAccessedAt > IDLE_TIMEOUT_MS) {
        this.sessions.delete(id);
      }
    }
  }
}

export const sessionManager = new SessionEngineManager();
