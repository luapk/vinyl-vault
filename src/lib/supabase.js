import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Cross-tab auth lock: re-entrant, bounded-wait navigator.locks.
//
// WHY A LOCK AT ALL: Supabase rotates refresh tokens. Two contexts sharing
// storage (an installed PWA window + a browser tab, or two tabs) each hold
// the same refresh token; refreshing concurrently outside the ~10s reuse
// grace window trips reuse detection and revokes the whole session family --
// the recurring "session expired" sign-outs.
//
// WHY RE-ENTRANCY MATTERS: supabase-js acquires this lock and then calls
// getSession() again from INSIDE it. A naive exclusive request made
// re-entrantly waits on a lock its own caller holds and never resolves
// (that deadlock is why a no-op lock was used previously, and why a plain
// "bounded wait" variant stalled every auth call for its full timeout).
// The module-level depth counter below short-circuits any acquire made
// while this context already holds the lock. Parallel (non-re-entrant)
// calls in the same tab also short-circuit; that is safe because a single
// supabase-js client deduplicates concurrent refreshes internally -- the
// lock's real job is cross-CONTEXT serialisation, which top-level acquires
// still provide.
//
// WHY BOUNDED: a tab that hangs while holding the lock (killed mid-refresh)
// must not freeze other tabs forever. After LOCK_TIMEOUT_MS the waiter
// proceeds unlocked -- worst case equals the old no-op behaviour.
const LOCK_TIMEOUT_MS = 5000;
let lockDepth = 0;
const reentrantBoundedLock = async (name, _acquireTimeout, fn) => {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) return await fn();
  if (lockDepth > 0) return await fn(); // re-entrant or same-tab parallel: run directly
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCK_TIMEOUT_MS);
  let acquired = false;
  try {
    return await navigator.locks.request(name, { mode: 'exclusive', signal: controller.signal }, async () => {
      acquired = true;
      clearTimeout(timer);
      lockDepth++;
      try { return await fn(); }
      finally { lockDepth--; }
    });
  } catch (err) {
    // AbortError before acquisition = another context is hung holding the
    // lock: proceed unlocked rather than deadlock. fn errors pass through.
    if (!acquired && err?.name === 'AbortError') {
      lockDepth++;
      try { return await fn(); }
      finally { lockDepth--; }
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

function makeClient(url, key) {
  const baseOptions = { auth: { lock: reentrantBoundedLock } };

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
