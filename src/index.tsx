import { resolve, dirname } from 'node:path';
import { realpathSync }     from 'node:fs';
import { fileURLToPath }    from 'node:url';
import dotenv               from 'dotenv';
import { render }           from 'ink';
import App                  from './ui/App.js';
import { login, logout, signup, loginWithGoogle, whoami } from './auth/commands.js';
import { refreshIfNeeded } from './auth/client.js';

// ── Resolve .env ──────────────────────────────────────────────────────────────
const realDir = (() => {
  try { return realpathSync(dirname(fileURLToPath(import.meta.url))); }
  catch { return dirname(fileURLToPath(import.meta.url)); }
})();

const candidates = [
  process.env['FELLA_HOME'] ? resolve(process.env['FELLA_HOME'], '.env') : null,  // set by fella.bat
  resolve(realDir, '..', '.env'),   // dist/../.env  → D:\fella\.env
  resolve(process.cwd(), '.env'),   // cwd fallback
].filter((p): p is string => Boolean(p));
for (const envPath of candidates) {
  const result = dotenv.config({ path: envPath, quiet: true });
  if (!result.error) break;
}

// ── Auth CLI commands ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args[0] === 'signup')                          { await signup();          process.exit(0); }
if (args[0] === 'login' && args[1] === '--google') { await loginWithGoogle(); /* fall through → launch TUI */ }
else if (args[0] === 'login')                      { await login();           /* fall through → launch TUI */ }
if (args[0] === 'logout')                          { await logout();          process.exit(0); }
if (args[0] === 'whoami')                          { await whoami();          process.exit(0); }

// ── Auth gate — loop until authenticated ────────────────────────────────────
while (true) {
  const token = await refreshIfNeeded();
  if (token) {
    render(<App isAuthenticated={true} />);
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