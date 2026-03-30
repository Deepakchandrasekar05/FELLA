import { resolve, dirname } from 'node:path';
import { realpathSync }     from 'node:fs';
import { fileURLToPath }    from 'node:url';
import { homedir }          from 'node:os';
import { execSync }         from 'node:child_process';
import dotenv               from 'dotenv';
import { render }           from 'ink';
import App                  from './ui/App.js';
import { login, logout, signup, loginWithGoogle, whoami } from './auth/commands.js';
import { refreshIfNeeded } from './auth/client.js';
import { MemoryStore } from './memory/store.js';

// ── Resolve .env ──────────────────────────────────────────────────────────────
const realDir = (() => {
  try { return realpathSync(dirname(fileURLToPath(import.meta.url))); }
  catch { return dirname(fileURLToPath(import.meta.url)); }
})();

const candidates = [
  process.env['FELLA_HOME'] ? resolve(process.env['FELLA_HOME'], '.env') : null,  // set by fella.bat
  resolve(homedir(), '.fella', '.env'),
  resolve(realDir, '..', '.env'),   // dist/../.env  → D:\fella\.env
  resolve(process.cwd(), '.env'),   // cwd fallback
].filter((p): p is string => Boolean(p));
for (const envPath of candidates) {
  const result = dotenv.config({ path: envPath, quiet: true, override: true });
  if (!result.error) break;
}

// Warm the MCP package cache so the first browser action starts faster.
try {
  execSync('npx --yes chrome-devtools-mcp@latest --version', {
    timeout: 30_000,
    stdio: 'ignore',
  });
} catch {
  // Non-fatal: first browser command may be slower if prewarm fails.
}

// ── Auth CLI commands ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args[0] === 'signup')                          { await signup();          process.exit(0); }
if (args[0] === 'login' && args[1] === '--google') { await loginWithGoogle(); /* fall through → launch TUI */ }
else if (args[0] === 'login')                      { await login();           /* fall through → launch TUI */ }
if (args[0] === 'logout')                          { await logout();          process.exit(0); }
if (args[0] === 'whoami')                          { await whoami();          process.exit(0); }
// ── Session commands ──────────────────────────────────────────────────────────────────
if (args[0] === 'sessions') {
  const store = new MemoryStore();
  const sessions = store.listSessions();
  if (sessions.length === 0) {
    console.log('No saved sessions found.');
  } else {
    console.log('\nSaved sessions:\n');
    for (const s of sessions) {
      const date = new Date(s.lastAt).toLocaleString();
      const count = s.turnCount;
      console.log(`  ${s.id}   ${date}   ${count} message${count !== 1 ? 's' : ''}`);
    }
    console.log('\nResume a session:  fella resume --session_id <id>\n');
  }
  process.exit(0);
}

if (args[0] === 'delete' && args[1] === 'sessions') {
  const rawId = (args[2] === '--session' || args[2] === '--session_id') ? args[3] : args[2];
  if (!rawId) {
    console.error('Usage: fella delete sessions --session <session-id>\n       fella delete sessions <session-id>');
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

if (args[0] === 'uninstall') {
  console.log('Uninstalling FELLA...');
  try {
    execSync('npm uninstall -g fella-cli', { stdio: 'inherit' });
    console.log('FELLA has been uninstalled successfully.');
  } catch (err) {
    console.error('Failed to uninstall FELLA:', err instanceof Error ? err.message : String(err));
  }
  process.exit(0);
}

let resumeSessionId: string | undefined;
if (args[0] === 'resume') {
  // Accepts both:  fella resume --session_id sess-...  OR  fella resume sess-...
  const rawId = args[1] === '--session_id' ? args[2] : args[1];
  if (!rawId) {
    console.error('Usage: fella resume --session_id <session-id>\n       fella resume <session-id>');
    process.exit(1);
  }
  const store = new MemoryStore();
  if (!store.sessionExists(rawId)) {
    console.error(`Session "${rawId}" not found. Run: fella sessions`);
    process.exit(1);
  }
  resumeSessionId = rawId;
}
// ── Auth gate — loop until authenticated ────────────────────────────────────
while (true) {
  const token = await refreshIfNeeded();
  if (token) {
    render(<App isAuthenticated={true} {...(resumeSessionId ? { sessionId: resumeSessionId } : {})} />);
    break;
  }

  // Show the unauthenticated TUI and wait for the user to pick a login method
  let selectedChoice: 'signup' | 'login' | 'google' | null = null;
  const { waitUntilExit } = render(
    <App
      isAuthenticated={false}
      onRequestAuth={(c) => { selectedChoice = c; }}
    />
  );
  await waitUntilExit();

  if (!selectedChoice) break; // ctrl+c — exit cleanly

  try {
    if      (selectedChoice === 'google') await loginWithGoogle();
    else if (selectedChoice === 'login')  await login();
    else                                  await signup();
  } catch {
    // auth failed — loop back so the user can try again
  }
}