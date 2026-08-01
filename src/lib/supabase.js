import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Cross-tab auth lock with a bounded wait.
//
// Why a real lock: Supabase ROTATES refresh tokens. Two contexts sharing
// storage (a Chrome tab + the installed PWA window on Android) each hold the
// same refresh token; if both refresh concurrently outside Supabase's ~10s
// reuse-grace window, reuse detection revokes the whole token family and
// every window gets signed out -- the recurring "session expired" errors.
// The previous no-op lock allowed exactly that.
//
// Why a bounded wait: the library's default navigator.locks lock can wait
// FOREVER if a holder tab hangs mid-refresh, freezing every getSession()
// and with it all DB queries (the original reason the no-op existed).
//
// This lock serialises auth work across all same-origin contexts, but never
// waits more than LOCK_TIMEOUT_MS for the lock; on timeout it proceeds
// unlocked (worst case equals the old behaviour, and a concurrent refresh
// inside the grace window returns the same session rather than revoking).
const LOCK_TIMEOUT_MS = 5000;
const boundedNavigatorLock = async (name, _acquireTimeout, fn) => {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) return await fn();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCK_TIMEOUT_MS);
  let acquired = false;
  try {
    return await navigator.locks.request(name, { mode: 'exclusive', signal: controller.signal }, async () => {
      acquired = true;
      clearTimeout(timer);
      return await fn();
    });
  } catch (err) {
    // AbortError before acquisition = lock held too long (hung tab): run
    // unlocked rather than deadlock. Errors from fn itself pass through.
    if (!acquired && err?.name === 'AbortError') return await fn();
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

function makeClient(url, key) {
  const baseOptions = { auth: { lock: boundedNavigatorLock } };

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
