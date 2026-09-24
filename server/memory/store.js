// server/memory/store.js - SQLite persistence via better-sqlite3
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const MEMORY_DIR = path.join(os.homedir(), '.fella');
const DB_PATH = path.join(MEMORY_DIR, 'memory.db');

export class MemoryStore {
  constructor() {
    mkdirSync(MEMORY_DIR, { recursive: true });

    this.db = new Database(DB_PATH);
    this.db.exec(`
      create table if not exists memory (
        id        integer primary key autoincrement,
        goal      text not null,
        steps     text not null,
        timestamp text not null
      );

      create table if not exists facts (
        id        integer primary key autoincrement,
        fact      text not null,
        source    text,
        timestamp text not null
      );

      create table if not exists sessions (
        id         text primary key,
        started_at text not null,
        last_at    text not null
      );

      create table if not exists session_turns (
        id         integer primary key autoincrement,
        session_id text not null,
        role       text not null,
        content    text not null,
        timestamp  text not null,
        visible    integer not null default 1
      );
    `);
  }

  /** Save what the agent did in the current run. */
  async save(entry) {
    this.db
      .prepare(`
        insert into memory (goal, steps, timestamp)
        values (?, ?, ?)
      `)
      .run(entry.goal, JSON.stringify(entry.steps), entry.timestamp);
  }

  /** Retrieve relevant past actions for the current goal. */
  recall(currentGoal, limit = 5) {
    const words = currentGoal
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 1);

    const rows = this.db
      .prepare(`
        select goal, steps, timestamp
        from memory
        order by timestamp desc
        limit 50
      `)
      .all();

    return rows
      .filter((row) => {
        if (words.length === 0) return true;
        const goal = row.goal.toLowerCase();
        return words.some((word) => goal.includes(word));
      })
      .slice(0, limit)
      .map((row) => ({
        goal: row.goal,
        steps: safeParse(row.steps),
        timestamp: row.timestamp,
      }));
  }

  /** Save a persistent fact that can be injected into future prompts. */
  saveFact(fact, source = 'user') {
    this.db
      .prepare(`
        insert into facts (fact, source, timestamp)
        values (?, ?, ?)
      `)
      .run(fact, source, new Date().toISOString());
  }

  /** Read all saved facts for context injection. */
  getFacts() {
    return this.db.prepare('select fact from facts order by id asc').all().map((r) => r.fact);
  }

  // ── Session persistence ────────────────────────────────────────────────────

  createSession(id) {
    const now = new Date().toISOString();
    this.db
      .prepare('insert or ignore into sessions (id, started_at, last_at) values (?, ?, ?)')
      .run(id, now, now);
  }

  touchSession(id) {
    this.db
      .prepare('update sessions set last_at = ? where id = ?')
      .run(new Date().toISOString(), id);
  }

  deleteSession(sessionId) {
    this.db.prepare('delete from session_turns where session_id = ?').run(sessionId);
    this.db.prepare('delete from sessions where id = ?').run(sessionId);
  }

  appendTurn(sessionId, role, content, timestamp, visible) {
    this.db
      .prepare(
        'insert into session_turns (session_id, role, content, timestamp, visible) values (?, ?, ?, ?, ?)',
      )
      .run(sessionId, role, content, timestamp, visible ? 1 : 0);
  }

  loadSessionHistory(sessionId) {
    const rows = this.db
      .prepare(
        'select role, content, visible from session_turns where session_id = ? order by id asc',
      )
      .all(sessionId);
    return rows.map((r) => ({ role: r.role, content: r.content, visible: r.visible === 1 }));
  }

  sessionExists(sessionId) {
    const row = this.db
      .prepare(
        `select s.id
         from sessions s
         join session_turns t on t.session_id = s.id and t.visible = 1
         where s.id = ?
         group by s.id
         having count(t.id) > 0`,
      )
      .get(sessionId);
    return row !== undefined;
  }

  listSessions(limit = 20) {
    const rows = this.db
      .prepare(
        `select s.id, s.started_at, s.last_at, count(t.id) as turn_count
         from sessions s
         left join session_turns t on t.session_id = s.id and t.visible = 1
         group by s.id
         having count(t.id) > 0
         order by s.last_at desc
         limit ?`,
      )
      .all(limit);
    return rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      lastAt: r.last_at,
      turnCount: r.turn_count,
    }));
  }
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
