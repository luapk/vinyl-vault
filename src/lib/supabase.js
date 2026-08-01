import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Override the cross-tab auth lock with a no-op.
//
// DO NOT replace this with a navigator.locks implementation without handling
// RE-ENTRANCY. supabase-js acquires this lock and then calls getSession()
// again from inside it; an `exclusive` navigator.locks request made
// re-entrantly from the same context waits on a lock its own caller holds, so
// it can never resolve. The library's default lock hits this (it is why the
// no-op was introduced), and a "bounded wait" variant that aborts after N
// seconds is no better: every auth call -- and therefore every DB query that
// reads the session, including the profile, role and community fetches --
// stalls for N seconds before proceeding.
//
// A correct replacement needs a module-level re-entrancy depth counter that
// short-circuits to fn() when this context already holds the lock, and would
// need testing in a real browser against both a normal tab and the installed
// PWA before shipping.
//
// Known trade-off of the no-op: two same-origin contexts (a browser tab plus
// the installed PWA) can refresh the rotated refresh token concurrently, which
// Supabase's reuse detection may treat as theft and revoke -- surfacing as
// "session expired". That is an inconvenience, not a data risk: unsynced
// records survive a dead session and re-upload automatically (see
// collectionMerge.js + the background retry in useCollection).
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
