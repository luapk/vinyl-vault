import { createClient } from '@supabase/supabase-js';

// Bearer-token verification for the /api handlers.
//
// TWO THINGS THIS FILE IS CAREFUL ABOUT, both learned from a real incident:
//
// 1. "The auth service failed" is NOT "you are signed out". Answering 401 to a
//    rate limit, a 5xx or a network wobble tells a perfectly valid session it
//    has expired, and the app then asks the user to sign out -- which empties
//    their screen and looks exactly like data loss. Only a token the auth
//    server actually rejects produces a 401 now; everything else is a 503 the
//    client can retry.
//
// 2. Verifying the same token on every single request is what made that
//    likely. Barcode scanning turned a slow flow into a fast one, so a user
//    can now fire many scans a minute, each one previously costing its own
//    round trip to the auth server. Successful verifications are cached for a
//    short window, so a burst of scans costs one call instead of dozens.

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;
const verified = new Map(); // token -> { user, until }

// Seconds-since-epoch expiry from the JWT body. Only used to make the cache
// entry expire no later than the token does; the signature is still checked by
// Supabase, so reading this without verifying it is safe.
function tokenExpiryMs(token) {
  try {
    const [, body] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

// Was this token actually rejected, or did the auth service just fail to
// answer? Exported for tests.
export function isTokenRejected(error) {
  if (!error) return false;
  const status = typeof error.status === 'number' ? error.status : null;
  if (status === 401 || status === 403) return true;
  // Anything else with a status (429, 500, 502, 503, 504) is the service
  // struggling, not a verdict on the token.
  if (status !== null) return false;
  // No status at all means a fetch/network failure inside supabase-js.
  return false;
}

function cacheGet(token) {
  const hit = verified.get(token);
  if (!hit) return null;
  if (hit.until <= Date.now()) { verified.delete(token); return null; }
  return hit.user;
}

function cachePut(token, user) {
  const exp = tokenExpiryMs(token);
  const until = exp ? Math.min(Date.now() + CACHE_TTL_MS, exp) : Date.now() + CACHE_TTL_MS;
  if (until <= Date.now()) return;
  if (verified.size >= CACHE_MAX) verified.delete(verified.keys().next().value);
  verified.set(token, { user, until });
}

export async function requireAuth(req, res) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const cached = cacheGet(token);
  if (cached) return cached;

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  let user, error;
  try {
    // 5s ceiling: a hung Supabase connection must not block the entire scan pipeline.
    const result = await Promise.race([
      supabase.auth.getUser(token),
      new Promise((_, reject) => setTimeout(() => reject(new Error('auth_timeout')), 5000)),
    ]);
    user = result.data?.user;
    error = result.error;
  } catch {
    res.status(503).json({ error: 'Authentication service unavailable', retryable: true });
    return null;
  }

  if (user && !error) {
    cachePut(token, user);
    return user;
  }

  if (isTokenRejected(error)) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  // Reached when the auth service errored without rejecting the token (rate
  // limited, upstream 5xx, transport failure) or returned neither a user nor
  // an error. Retryable, and emphatically not a reason to sign anyone out.
  console.log('[auth] verification unavailable:', error?.status ?? 'no-status', error?.message ?? 'no user returned');
  res.status(503).json({ error: 'Authentication service unavailable', retryable: true });
  return null;
}
