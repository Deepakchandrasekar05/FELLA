// auth/supabase.ts — Shared Supabase client (singleton)

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ── Lazily initialised so dotenv loads before these are read ─────────────────
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
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
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return _client;
}
