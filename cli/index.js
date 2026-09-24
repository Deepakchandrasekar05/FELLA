// cli/index.js — FELLA CLI Entry Point
import React from 'react';
import { render } from 'ink';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import dotenv from 'dotenv';

import App from './app.js';
import { login, logout, signup, loginWithGoogle, whoami } from './authCommands.js';
import { refreshIfNeeded } from '../server/auth/sessionStore.js';
import { MemoryStore } from '../server/memory/store.js';

const h = React.createElement;
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Resolve .env ──────────────────────────────────────────────────────────────
const candidates = [
  process.env['FELLA_HOME'] ? resolve(process.env['FELLA_HOME'], '.env') : null,
  resolve(homedir(), '.fella', '.env'),
  resolve(__dirname, '..', '.env'),
  resolve(process.cwd(), '.env'),
].filter(Boolean);

for (const envPath of candidates) {
  const result = dotenv.config({ path: envPath, override: true });
  if (!result.error) break;
}

// ── Command Line Arguments Dispatch ───────────────────────────────────────────
const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();

if (command === '--help' || command === '-h' || command === 'help') {
  console.log(`
FELLA — File Exploration and Local Logic Automation (CLI)

Usage:
  fella                      Start interactive agent session
  fella resume <id>          Resume a saved conversation
  fella sessions             List previous saved sessions
  fella delete sessions <id> Delete a session from database
  fella login                Sign in with email and password
  fella login --google       Sign in with Google in browser
  fella signup               Create a new account
  fella logout               Sign out of current account
  fella whoami               Check current authentication status
  fella --version            Show version
`);
  process.exit(0);
}

if (command === '--version' || command === '-v' || command === 'version') {
  console.log('FELLA v2.0.0 (Agentic Fullstack CLI)');
  process.exit(0);
}

if (command === 'signup') {
  await signup();
  process.exit(0);
}

if (command === 'login' && args[1] === '--google') {
  await loginWithGoogle();
  // Fall through to launch TUI
} else if (command === 'login') {
  await login();
  // Fall through to launch TUI
}

if (command === 'logout') {
  await logout();
  process.exit(0);
}

if (command === 'whoami') {
  await whoami();
  process.exit(0);
}

if (command === 'sessions') {
  const store = new MemoryStore();
  const sessions = store.listSessions();
  if (sessions.length === 0) {
    console.log('No saved sessions found.');
  } else {
    console.log('\nSaved sessions:\n');
    for (const s of sessions) {
      const date = new Date(s.lastAt).toLocaleString();
      console.log(`  ${s.id.padEnd(28)} ${date}   (${s.turnCount} turn${s.turnCount !== 1 ? 's' : ''})`);
    }
    console.log('\nTo resume: fella resume <session-id>\n');
  }
  process.exit(0);
}

if (command === 'delete' && args[1] === 'sessions') {
  const rawId = (args[2] === '--session' || args[2] === '--session_id') ? args[3] : args[2];
  if (!rawId) {
    console.error('Usage: fella delete sessions <session-id>');
    process.exit(1);
  }
  const store = new MemoryStore();
  if (!store.sessionExists(rawId)) {
    console.error(`Session "${rawId}" not found. Run: fella sessions`);
    process.exit(1);
  }
  store.deleteSession(rawId);
  console.log(`Session "${rawId}" deleted successfully.`);
  process.exit(0);
}

let resumeSessionId;
if (command === 'resume') {
  const rawId = args[1] === '--session_id' ? args[2] : args[1];
  if (!rawId) {
    console.error('Usage: fella resume <session-id>');
    process.exit(1);
  }
  const store = new MemoryStore();
  if (!store.sessionExists(rawId)) {
    console.error(`Session "${rawId}" not found. Run: fella sessions`);
    process.exit(1);
  }
  resumeSessionId = rawId;
}

// ── Launch Ink Terminal User Interface ───────────────────────────────────────
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);

while (true) {
  const token = hasSupabase ? await refreshIfNeeded() : true;

  if (token || !hasSupabase) {
    render(h(App, {
      isAuthenticated: true,
      ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
    }));
    break;
  }

  let selectedChoice = null;
  const { waitUntilExit } = render(
    h(App, {
      isAuthenticated: false,
      onRequestAuth: (c) => { selectedChoice = c; },
    })
  );
  await waitUntilExit();

  if (!selectedChoice) break;

  try {
    if (selectedChoice === 'google') await loginWithGoogle();
    else if (selectedChoice === 'login') await login();
    else await signup();
  } catch (err) {
    console.error('Auth error:', err);
  }
}
