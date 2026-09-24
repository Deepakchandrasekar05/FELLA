// cli/authCommands.js — Terminal interactive auth commands for FELLA CLI
import * as readline from 'node:readline';
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { getSupabase } from '../server/auth/supabase.js';
import { saveAuthToken, clearAuthToken, currentUser, refreshIfNeeded } from '../server/auth/sessionStore.js';

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptPassword(question) {
  process.stdout.write(question);
  return new Promise((resolve) => {
    const chars = [];
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        if (process.stdin.setRawMode) process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(chars.join(''));
      } else if (ch === '\u0003') {
        process.stdout.write('\n');
        process.exit(0);
      } else if (ch === '\u007f' || ch === '\b') {
        if (chars.length > 0) {
          chars.pop();
          process.stdout.write('\b \b');
        }
      } else {
        chars.push(ch);
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', onData);
  });
}

export async function login() {
  console.log('\n  ── FELLA Login ────────────────────────────────────────\n');
  const client = getSupabase();
  if (!client) {
    console.error('  ✗ Supabase is not configured. Check your .env file.\n');
    return;
  }

  const email = await prompt('  Email:    ');
  const password = await promptPassword('  Password: ');

  console.log('\n  Signing in…');
  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    console.error(`\n  ✗ Login failed: ${error?.message || 'No session returned'}\n`);
    return;
  }

  saveAuthToken({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token ?? '',
    email: data.session.user?.email ?? email,
    userId: data.session.user?.id ?? '',
    expiresAt: Date.now() + (data.session.expires_in ?? 3600) * 1000,
  });
  console.log(`\n  ✓ Logged in as ${data.session.user?.email ?? email}\n`);
}

export async function signup() {
  console.log('\n  ── FELLA Sign Up ──────────────────────────────────────\n');
  const client = getSupabase();
  if (!client) {
    console.error('  ✗ Supabase is not configured. Check your .env file.\n');
    return;
  }

  const email = await prompt('  Email:    ');
  const password = await promptPassword('  Password: ');
  const confirm = await promptPassword('  Confirm:  ');

  if (password !== confirm) {
    console.error('  ✗ Passwords do not match.\n');
    return;
  }

  console.log('\n  Creating account…');
  const { error } = await client.auth.signUp({ email, password });

  if (error) {
    console.error(`  ✗ Sign-up failed: ${error.message}\n`);
    return;
  }

  console.log(`\n  ✓ Account created for ${email}`);
  console.log('  Check your inbox to confirm your email, then run: fella login\n');
}

export async function loginWithGoogle() {
  const client = getSupabase();
  if (!client) {
    console.error('  ✗ Supabase is not configured. Check your .env file.\n');
    return;
  }

  const CALLBACK_PORT = 54321;
  const CALLBACK_URL = `http://localhost:${CALLBACK_PORT}`;

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (!req.url) {
        res.writeHead(400).end('Missing URL');
        return;
      }

      const reqUrl = new URL(req.url, CALLBACK_URL);
      const code = reqUrl.searchParams.get('code');
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' }).end('<h1>No auth code received</h1>');
        server.close();
        return;
      }

      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error || !data.session) {
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(`<h1>Login failed: ${error?.message}</h1>`);
        server.close();
        return;
      }

      saveAuthToken({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token ?? '',
        email: data.session.user?.email ?? '',
        userId: data.session.user?.id ?? '',
        expiresAt: Date.now() + (data.session.expires_in ?? 3600) * 1000,
      });

      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<h1>Logged in to FELLA! You can close this tab.</h1>');
      setTimeout(() => server.close(), 1500);
      console.log(`\n  ✓ Logged in as ${data.session.user?.email}\n`);
      resolve(data.session.user?.email);
    });

    server.listen(CALLBACK_PORT, async () => {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: CALLBACK_URL },
      });

      if (error || !data.url) {
        server.close();
        console.error('Failed to generate OAuth URL:', error?.message);
        return;
      }

      console.log('\n  Opening browser for Google login…');
      console.log(' ', data.url, '\n');
      const cmd = process.platform === 'win32'
        ? `start "" "${data.url}"`
        : process.platform === 'darwin'
          ? `open "${data.url}"`
          : `xdg-open "${data.url}"`;
      exec(cmd);
    });
  });
}

export async function logout() {
  clearAuthToken();
  console.log('\n  ✓ Logged out successfully.\n');
}

export async function whoami() {
  const email = currentUser();
  if (email) {
    console.log(`\n  Logged in as: ${email}\n`);
  } else {
    console.log('\n  Not logged in. Run: fella login\n');
  }
}
