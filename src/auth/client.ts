// auth/client.ts — Supabase client + token storage (single source of truth)

import { createClient }  from '@supabase/supabase-js';
import * as fs           from 'node:fs';
import * as path         from 'node:path';
import * as os           from 'node:os';

// ── Supabase client — lazily initialised so dotenv has time to load ──────────
let _client: ReturnType<typeof createClient> | null = null;

function getClient(): ReturnType<typeof createClient> {
  if (!_client) {
    const url = process.env['SUPABASE_URL']      ?? '';
    const key = process.env['SUPABASE_ANON_KEY'] ?? '';
    if (!url || !key) {
      console.error(
        '\n  ✗ Supabase is not configured.\n' +
        '    Add SUPABASE_URL and SUPABASE_ANON_KEY to your .env file.\n',
      );
      process.exit(1);
    }
    _client = createClient(url, key, {
      auth: {
        flowType: 'pkce',   // redirects come back with ?code= (query param), not #hash
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return _client;
}

// Proxy so callers can keep using `supabase.auth.xxx` without changes
export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_, prop: string | symbol) {
    return Reflect.get(getClient(), prop);
  },
});

// ── Token storage ─────────────────────────────────────────────────────────────
const AUTH_DIR  = path.join(os.homedir(), '.fella');
const AUTH_FILE = path.join(AUTH_DIR, 'auth.json');

export interface StoredAuth {
  accessToken:  string;
  refreshToken: string;
  email:        string;
  userId:       string;
  expiresAt:    number;   // Unix epoch milliseconds
}

export function saveAuthToken(auth: StoredAuth): void {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

export function loadAuthToken(): StoredAuth | null {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8')) as StoredAuth;
  } catch { return null; }
}

export function clearAuthToken(): void {
  if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
}

/** Return the currently logged-in email, or null if not authenticated / expired. */
export function currentUser(): string | null {
  const auth = loadAuthToken();
  if (!auth) return null;
  if (Date.now() >= auth.expiresAt - 60_000) return null; // expired
  return auth.email || null;
}

/**
 * Silently refresh the access token if it is about to expire.
 * Returns the valid access token, or null if the user is not logged in.
 */
export async function refreshIfNeeded(): Promise<string | null> {
  const auth = loadAuthToken();
  if (!auth) return null;

  // Token still valid (> 60 s remaining)
  if (Date.now() < auth.expiresAt - 60_000) return auth.accessToken;

  // Attempt a silent refresh
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: auth.refreshToken,
  });

  if (error || !data.session) {
    clearAuthToken();
    return null;
  }

  saveAuthToken({
    accessToken:  data.session.access_token,
    refreshToken: data.session.refresh_token,
    email:        auth.email,
    userId:       auth.userId,
    expiresAt:    Date.now() + data.session.expires_in * 1000,
  });

  return data.session.access_token;
}
