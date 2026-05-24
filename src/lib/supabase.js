import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

function makeClient(url, key) {
  // Publishable keys (sb_publishable_...) are not JWTs.
  // supabase-js falls back to using the key itself as the Bearer token when no
  // session exists, which PostgREST rejects as invalid. Strip that fallback so
  // the gateway uses only the apikey header to determine anon role access.
  if (!key.startsWith('sb_publishable_') && !key.startsWith('sb_secret_')) {
    return createClient(url, key);
  }
  return createClient(url, key, {
    global: {
      fetch: (input, init = {}) => {
        const headers = new Headers(init.headers);
        if (headers.get('Authorization') === `Bearer ${key}`) {
          headers.delete('Authorization');
        }
        return fetch(input, { ...init, headers });
      },
    },
  });
}

// When env vars are absent (local dev without Supabase) expose a null client
// so the rest of the app can gracefully fall back to localStorage.
export const supabase = (url && key) ? makeClient(url, key) : null;

export const isSupabaseEnabled = !!(url && key);
