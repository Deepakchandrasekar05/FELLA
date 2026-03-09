// auth/session.ts — Persist / load the authenticated session on disk

import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join }                                                            from 'node:path';
import { homedir }                                                         from 'node:os';
import type { Session }                                                    from '@supabase/supabase-js';

// Store the session file in the OS user-data directory so it survives updates.
const SESSION_DIR  = join(homedir(), '.fella');
const SESSION_FILE = join(SESSION_DIR, 'session.json');

export interface StoredSession {
  access_token:  string;
  refresh_token: string;
  expires_at:    number;     // Unix epoch seconds
  user_email:    string | null;
}

/** Persist a Supabase session to disk. */
export function saveSession(session: Session): void {
  mkdirSync(SESSION_DIR, { recursive: true });
  const stored: StoredSession = {
    access_token:  session.access_token,
    refresh_token: session.refresh_token ?? '',
    expires_at:    session.expires_at    ?? 0,
    user_email:    session.user?.email   ?? null,
  };
  // File mode 0o600 so only the owning user can read it (best-effort on Windows)
  writeFileSync(SESSION_FILE, JSON.stringify(stored, null, 2), { mode: 0o600, encoding: 'utf8' });
}

/** Load the persisted session, or return null if none exists / file is corrupt. */
export function loadSession(): StoredSession | null {
  if (!existsSync(SESSION_FILE)) return null;
  try {
    const raw  = readFileSync(SESSION_FILE, 'utf8');
    const data = JSON.parse(raw) as StoredSession;
    if (!data.access_token) return null;
    return data;
  } catch {
    return null;
  }
}

/** Check whether the stored session is still valid (not expired). */
export function isSessionValid(session: StoredSession): boolean {
  if (!session.expires_at) return true; // no expiry info — assume valid
  return Math.floor(Date.now() / 1000) < session.expires_at - 30; // 30 s grace
}

/** Remove the session file (logout). */
export function clearSession(): void {
  if (existsSync(SESSION_FILE)) unlinkSync(SESSION_FILE);
}

/** Return the currently logged-in email, or null. */
export function currentUser(): string | null {
  const session = loadSession();
  if (!session || !isSessionValid(session)) return null;
  return session.user_email;
}
