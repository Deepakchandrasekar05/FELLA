// auth/commands.ts — All auth CLI commands (signup, login, google, logout, whoami)

import { createServer }                                         from 'node:http';
import { exec }                                                  from 'node:child_process';
import * as readline                                             from 'node:readline';
import { supabase, saveAuthToken, clearAuthToken, loadAuthToken } from './client.js';

// ── Input helpers ─────────────────────────────────────────────────────────────

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function askHidden(question: string): Promise<string> {
  return new Promise(resolve => {
    process.stdout.write(question);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    let input = '';
    const handler = (char: Buffer | string) => {
      const c = char.toString();
      if (c === '\r' || c === '\n' || c === '\u0004') {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(input);
      } else if (c === '\u0003') {
        process.stdout.write('\n');
        process.exit(0);
      } else if (c === '\u007f') {
        input = input.slice(0, -1);
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(question + '*'.repeat(input.length));
      } else {
        input += c;
        process.stdout.write('*');
      }
    };
    process.stdin.on('data', handler);
  });
}

// ── Signup ────────────────────────────────────────────────────────────────────

export async function signup(): Promise<void> {
  console.log('\n◆ FELLA — Create Account\n');
  const email    = await ask('  Email:    ');
  const password = await askHidden('  Password: ');

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    console.error(`\n  ✖ Signup failed: ${error.message}\n`);
    process.exit(1);
  }

  if (data.user && !data.session) {
    console.log(`\n  ✓ Account created!`);
    console.log(`    Check ${email} for a confirmation link.`);
    console.log(`    After confirming, run: fella login\n`);
    return;
  }

  if (data.session) {
    saveAuthToken({
      accessToken:  data.session.access_token,
      refreshToken: data.session.refresh_token,
      email:        data.user?.email ?? email,
      userId:       data.user?.id    ?? '',
      expiresAt:    Date.now() + data.session.expires_in * 1000,
    });
    console.log(`\n  ✓ Signed up and logged in as ${email}\n`);
  }
}

// ── Email login ───────────────────────────────────────────────────────────────

export async function login(): Promise<void> {
  console.log('\n◆ FELLA — Login\n');
  const email    = await ask('  Email:    ');
  const password = await askHidden('  Password: ');

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.error(`\n  ✖ Login failed: ${error.message}`);
    console.error('    Run "fella signup" to create an account.\n');
    process.exit(1);
  }

  saveAuthToken({
    accessToken:  data.session.access_token,
    refreshToken: data.session.refresh_token,
    email:        data.user.email  ?? email,
    userId:       data.user.id,
    expiresAt:    Date.now() + data.session.expires_in * 1000,
  });

  console.log(`\n  ✓ Logged in as ${data.user.email}\n`);
}

// ── Google login ──────────────────────────────────────────────────────────────

const CALLBACK_PORT = 54321;
const CALLBACK_URL  = `http://localhost:${CALLBACK_PORT}`;

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
  <head>
    <title>FELLA — Logged in</title>
    <style>
      body { font-family: sans-serif; display: flex; justify-content: center;
             align-items: center; height: 100vh; margin: 0; background: #0d1117; color: #e6edf3; }
      .card { text-align: center; padding: 2rem 3rem; border: 1px solid #30363d;
              border-radius: 12px; background: #161b22; }
      h1 { color: #3fa5d4; margin-bottom: 0.5rem; }
      p  { color: #8b949e; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>&#10003; Logged in to FELLA</h1>
      <p>You can close this tab and return to your terminal.</p>
    </div>
  </body>
</html>`;

export async function loginWithGoogle(): Promise<void> {
  console.log('\n◆ FELLA — Login with Google\n');

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (!req.url) {
        res.writeHead(400).end('<h2>Missing request URL.</h2>');
        return;
      }

      const reqUrl     = new URL(req.url, CALLBACK_URL);
      const oauthError = reqUrl.searchParams.get('error');

      if (oauthError) {
        const desc = reqUrl.searchParams.get('error_description') ?? oauthError;
        res.writeHead(400, { 'Content-Type': 'text/html' })
           .end(`<h2>Login failed: ${desc}</h2><p>Close this tab and try again.</p>`);
        server.close();
        reject(new Error(`OAuth error: ${desc}`));
        return;
      }

      const code = reqUrl.searchParams.get('code');
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
           .end('<h2>No code received. Close this tab and try again.</h2>');
        server.close();
        reject(new Error('No auth code received'));
        return;
      }

      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error || !data.session) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
           .end('<h2>Login failed. Close this tab and try again.</h2>');
        server.close();
        reject(error ?? new Error('Session exchange failed'));
        return;
      }

      saveAuthToken({
        accessToken:  data.session.access_token,
        refreshToken: data.session.refresh_token,
        email:        data.user.email   ?? '',
        userId:       data.user.id,
        expiresAt:    Date.now() + data.session.expires_in * 1000,
      });

      res.writeHead(200, { 'Content-Type': 'text/html' }).end(SUCCESS_HTML);
      console.log(`\n  ✓ Logged in as ${data.user.email}\n`);
      server.close();
      resolve();
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${CALLBACK_PORT} is already in use. Close the conflicting process and try again.`));
      } else {
        reject(err);
      }
    });

    server.listen(CALLBACK_PORT, async () => {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options:  { redirectTo: CALLBACK_URL },
      });

      if (error || !data.url) {
        server.close();
        reject(new Error(error?.message ?? 'Failed to get Google login URL'));
        return;
      }

      console.log('  Opening browser…');
      console.log('  If the browser does not open, visit:\n  ', data.url, '\n');

      const cmd =
        process.platform === 'win32'  ? `start "" "${data.url}"` :
        process.platform === 'darwin' ? `open "${data.url}"` :
                                        `xdg-open "${data.url}"`;
      exec(cmd);
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('Login timed out after 2 minutes'));
    }, 120_000);

    server.on('close', () => clearTimeout(timeout));
  });
}

// ── Logout ────────────────────────────────────────────────────────────────────

export async function logout(): Promise<void> {
  const auth = loadAuthToken();
  if (!auth) {
    console.log('\n  Already logged out.\n');
    return;
  }

  // Local logout should not require Supabase configuration.
  const hasSupabaseConfig = Boolean(process.env['SUPABASE_URL'] && process.env['SUPABASE_ANON_KEY']);
  if (hasSupabaseConfig) {
    try {
      await supabase.auth.setSession({
        access_token: auth.accessToken,
        refresh_token: auth.refreshToken,
      });
      await supabase.auth.signOut();
    } catch {
      // Ignore remote sign-out failures; local token removal is authoritative for CLI logout.
    }
  }

  clearAuthToken();
  console.log(`\n  ✓ Logged out from ${auth.email}\n`);
}

// ── Whoami ────────────────────────────────────────────────────────────────────

export async function whoami(): Promise<void> {
  const auth = loadAuthToken();
  if (!auth) {
    console.log('\n  Not logged in. Run: fella login\n');
    return;
  }
  console.log(`\n◆ FELLA — Account`);
  console.log(`  Email:  ${auth.email}`);
  console.log(`  Plan:   free\n`);
}
