// server/auth/sessionStore.js - Token storage on disk at %USERPROFILE%/.fella/auth.json
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getSupabase } from './supabase.js';

const AUTH_DIR  = path.join(os.homedir(), '.fella');
const AUTH_FILE = path.join(AUTH_DIR, 'auth.json');

export function saveAuthToken(auth) {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

export function loadAuthToken() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export function clearAuthToken() {
  if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
}

export function currentUser() {
  const auth = loadAuthToken();
  if (!auth) return null;
  if (Date.now() >= auth.expiresAt - 60_000) return null;
  return auth.email || null;
}

export async function refreshIfNeeded() {
  const auth = loadAuthToken();
  if (!auth) return null;

  if (Date.now() < auth.expiresAt - 60_000) return auth.accessToken;

  const client = getSupabase();
  if (!client) {
    clearAuthToken();
    return null;
  }

  const { data, error } = await client.auth.refreshSession({
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
