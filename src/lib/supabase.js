import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Cross-tab auth lock: strictly serialising, bounded-wait navigator.locks.
//
// WHY A LOCK AT ALL: Supabase rotates refresh tokens. Two contexts sharing
// storage (an installed PWA window + a browser tab, or two tabs) each hold
// the same refresh token; refreshing concurrently outside the ~10s reuse
// grace window trips reuse detection and revokes the whole session family --
// the recurring "session expired" sign-outs.
//
// WHY STRICT SERIALISATION IS SAFE: supabase-js NEVER re-enters this lock.
// Its _acquireLock tracks lockAcquired itself and routes nested acquires
// through an internal pendingInLock queue, so only top-level acquires reach
// us. The historic "custom lock deadlocks the app" incident was actually the
// onAuthStateChange emission awaiting a supabase query (which waits on
// initialize(), which waits on the emission -- circular); that is fixed at
// the source in useAuth (see the DEADLOCK GUARD there) and regression-tested
// by stress/session.spec.mjs. Do NOT add a same-tab short-circuit here: an
// earlier version that let parallel same-tab acquires run unlocked allowed a
// refresh to bypass cross-window serialisation whenever any other auth call
// held the lock, replaying a stale token -- caught by stress/race.spec.mjs.
//
// WHY BOUNDED: a context that hangs while holding the lock (killed
// mid-refresh) must not freeze other tabs forever. After LOCK_TIMEOUT_MS the
// waiter proceeds unlocked -- worst case equals the old no-op behaviour.
const LOCK_TIMEOUT_MS = 5000;
const boundedAuthLock = async (name, _acquireTimeout, fn) => {
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
    // AbortError before acquisition = the holder is hung: proceed unlocked
    // rather than deadlock. fn errors pass through untouched.
    if (!acquired && err?.name === 'AbortError') return await fn();
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

function makeClient(url, key) {
  const baseOptions = { auth: { lock: boundedAuthLock } };

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

// Dev-only seam for the stress suite (stress/*.spec.mjs): lets tests trigger
// auth operations like refreshSession directly. import.meta.env.DEV is
// compile-time false in production builds, so this line is stripped there.
if (import.meta.env.DEV && typeof window !== 'undefined') window.__supabase = supabase;
