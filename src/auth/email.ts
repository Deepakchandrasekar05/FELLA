// auth/email.ts — Email + password signup and login via Supabase

import * as readline                  from 'node:readline';
import { supabase, saveAuthToken }    from './client.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Prompt the user for a value in the terminal. */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Prompt for a password without echoing characters (replaces each char with *). */
function promptPassword(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve) => {
    const chars: string[] = [];

    // Switch stdin to raw mode so we handle keystrokes ourselves
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004' /* Ctrl-D */) {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(chars.join(''));
      } else if (ch === '\u0003' /* Ctrl-C */) {
        process.stdout.write('\n');
        process.exit(0);
      } else if (ch === '\u007f' /* Backspace */) {
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

// ── Email validation ──────────────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Signup ────────────────────────────────────────────────────────────────────

/**
 * Interactively collect email + password and create a new Supabase account.
 * A confirmation email will be sent; the user must verify before logging in.
 */
export async function signup(): Promise<void> {
  console.log('\n  ── FELLA Sign Up ──────────────────────────────────────\n');

  const email = await prompt('  Email:    ');
  if (!isValidEmail(email)) {
    console.error('  ✗ Invalid email address.\n');
    process.exit(1);
  }

  const password = await promptPassword('  Password: ');
  if (password.length < 8) {
    console.error('  ✗ Password must be at least 8 characters.\n');
    process.exit(1);
  }

  const confirm = await promptPassword('  Confirm:  ');
  if (password !== confirm) {
    console.error('  ✗ Passwords do not match.\n');
    process.exit(1);
  }

  console.log('\n  Creating account…');

  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    console.error(`  ✗ Sign-up failed: ${error.message}\n`);
    process.exit(1);
  }

  console.log(`\n  ✓ Account created for ${email}`);
  console.log('  Check your inbox to confirm your email, then run: fella login\n');
}

// ── Login ─────────────────────────────────────────────────────────────────────

/**
 * Interactively collect email + password and sign in with Supabase.
 * Persists the session to ~/.fella/session.json on success.
 */
export async function loginWithEmail(): Promise<void> {
  console.log('\n  ── FELLA Login ────────────────────────────────────────\n');

  const email    = await prompt('  Email:    ');
  const password = await promptPassword('  Password: ');

  console.log('\n  Signing in…');

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    console.error(`\n  ✗ Login failed: ${error?.message ?? 'No session returned'}\n`);
    process.exit(1);
  }

  saveAuthToken({
    accessToken:  data.session.access_token,
    refreshToken: data.session.refresh_token ?? '',
    email:        data.session.user?.email   ?? email,
    userId:       data.session.user?.id      ?? '',
    expiresAt:    Date.now() + (data.session.expires_in ?? 3600) * 1000,
  });
  console.log(`\n  ✓ Logged in as ${data.session.user?.email ?? email}\n`);
}
