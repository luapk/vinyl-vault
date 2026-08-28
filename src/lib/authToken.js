import { supabase } from './supabase.js';

// A Supabase access token expires roughly hourly. The cached token from useAuth
// stays fresh only while background auto-refresh fires; if the app sat idle the
// cached token can be expired, so authed API calls 401. getSession() returns the
// current token and transparently refreshes an expired one. Race it against a
// timeout so a stalled refresh can never hang the call, and fall back to the
// cached token if it does.
//
// Lives here rather than inside a component file because every authed fetch in
// the app needs it, and a second copy would be a second thing to get wrong.
export async function freshAccessToken(fallback) {
  try {
    const { data } = await Promise.race([
      supabase.auth.getSession(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('getSession timeout')), 8000)),
    ]);
    return data?.session?.access_token || fallback;
  } catch {
    return fallback;
  }
}
