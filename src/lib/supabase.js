import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Override the cross-tab auth lock with a no-op. The default uses
// navigator.locks which can deadlock when a previous tab/instance hangs
// while holding the lock, causing every subsequent getSession() call to
// wait forever and freezing all DB queries that internally read the session.
const noopLock = async (_name, _acquireTimeout, fn) => fn();

function makeClient(url, key) {
  const baseOptions = { auth: { lock: noopLock } };

  // Publishable keys (sb_publishable_...) are not JWTs. supabase-js falls back
  // to using the key itself as the Bearer token when no session exists, which
  // PostgREST rejects. Strip that fallback so the gateway uses only the apikey
  // header to determine anon role access.
  if (!key.startsWith('sb_publishable_') && !key.startsWith('sb_secret_')) {
    return createClient(url, key, baseOptions);
  }
  return createClient(url, key, {
    ...baseOptions,
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
