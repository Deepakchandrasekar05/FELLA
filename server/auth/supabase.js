// server/auth/supabase.js — Shared Supabase client (singleton)
import { createClient } from '@supabase/supabase-js';

let _client = null;

export function getSupabase() {
  if (!_client) {
    const url = process.env['SUPABASE_URL'] ?? '';
    const key = process.env['SUPABASE_ANON_KEY'] ?? '';
    if (!url || !key) {
      return null;
    }
    _client = createClient(url, key, {
      auth: {
        flowType: 'pkce',
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return _client;
}

export const supabase = new Proxy({}, {
  get(_, prop) {
    const client = getSupabase();
    if (!client) {
      throw new Error('Supabase is not configured. Check SUPABASE_URL and SUPABASE_ANON_KEY in your .env file.');
    }
    return Reflect.get(client, prop);
  },
});
