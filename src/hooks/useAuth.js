import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseEnabled } from '../lib/supabase';
import { setSentryUser } from '../lib/sentry.js';

// "admin" is a convenience alias for the real admin account.
const ADMIN_EMAIL = 'admin@vault.local';

function resolveEmail(usernameOrEmail) {
  if (!usernameOrEmail) return '';
  if (usernameOrEmail === 'admin') return ADMIN_EMAIL;
  return usernameOrEmail.includes('@') ? usernameOrEmail : usernameOrEmail;
}

export function useAuth() {
  const [user, setUser]       = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // Kept in sync by onAuthStateChange -- always the latest valid JWT without
  // any network call. Avoids the getSession() race on slow mobile connections.
  const [accessToken, setAccessToken] = useState(null);
  // Track in-flight fetchProfile calls so INITIAL_SESSION and getSession()
  // don't both trigger a full round-trip concurrently.
  const fetchingRef = useRef(null);

  const fetchProfile = useCallback(async (userId) => {
    if (!supabase || !userId) return null;
    const { data, error } = await supabase
      .from('profiles')
      // No email: it is on the auth session already (user.email), and the
      // column is revoked from anon/authenticated so a public profile cannot
      // hand somebody else's address to anyone holding the anon key.
      .select('id, role, avatar_url, display_name, username, bio, is_public, preferences, subscription_tier, subscription_status, scans_this_period, scans_period_end')
      .eq('id', userId)
      .single();
    // Don't swallow failures silently: the self-healing effect below retries
    // on null, and the log makes cold-start failures diagnosable.
    if (error) console.log('[profile] fetch failed:', error.message);
    return data || null;
  }, []);

  // Deduplicated fetch: if a fetch is already in flight for this userId, reuse it.
  const fetchProfileOnce = useCallback((userId) => {
    if (!userId) return Promise.resolve(null);
    if (fetchingRef.current?.userId === userId) return fetchingRef.current.promise;
    const promise = fetchProfile(userId).finally(() => {
      if (fetchingRef.current?.userId === userId) fetchingRef.current = null;
    });
    fetchingRef.current = { userId, promise };
    return promise;
  }, [fetchProfile]);

  useEffect(() => {
    if (!isSupabaseEnabled) { setLoading(false); return; }

    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000));
    Promise.race([supabase.auth.getSession(), timeout])
      .then(async ({ data: { session } }) => {
        setUser(session?.user ?? null);
        setAccessToken(session?.access_token ?? null);
        if (session?.user) {
          const p = await fetchProfileOnce(session.user.id);
          setProfile(p);
        }
        setLoading(false);
      }).catch(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user ?? null);
        setAccessToken(session?.access_token ?? null);
        if (session?.user) {
          // For INITIAL_SESSION, reuse any in-flight getSession fetch.
          // For subsequent events (TOKEN_REFRESHED, SIGNED_IN) always re-fetch.
          const fetchFn = event === 'INITIAL_SESSION' ? fetchProfileOnce : fetchProfile;
          // DEADLOCK GUARD -- do not await supabase calls inside this callback.
          // supabase-js awaits these callbacks while holding its auth lock (and
          // during initialize()); a query here calls getSession(), which waits
          // for initialize() to finish -> circular wait. When the emission
          // fires during a with-session boot the whole client wedges: profile,
          // admin and connections never load until a lucky reload wins the
          // race. Dispatching after the emission (per supabase's own docs)
          // breaks the cycle. Found by stress/session.spec.mjs.
          setTimeout(async () => {
            const p = await fetchFn(session.user.id);
            setProfile(p);
          }, 0);
        } else if (event === 'SIGNED_OUT') {
          // Only clear profile on explicit sign-out, not on token refresh edge cases
          // where session is briefly null before a new token arrives.
          setProfile(null);
        }
      }
    );
    return () => subscription.unsubscribe();
  }, [fetchProfile, fetchProfileOnce]);

  // Tag error reports with the (anonymous) user id so a tester's repeated
  // crashes group together. No-op without a Sentry DSN.
  useEffect(() => { setSentryUser(user); }, [user?.id]);

  // Self-healing profile load. The boot-time fetch can fail silently on a
  // cold start: the stored access token may be expired and the query races
  // its refresh, or the first request dies on a flaky mobile connection.
  // Without the profile the avatar, admin access and tier are missing until
  // a manual refresh. While signed in with no profile (or a stale one from a
  // previous account), retry with backoff until it lands. Purely additive:
  // it does nothing whenever the normal path succeeds.
  useEffect(() => {
    if (!user?.id || profile?.id === user.id) return;
    let cancelled = false;
    let attempt = 0;
    let timer;
    const tryFetch = async () => {
      if (cancelled) return;
      const p = await fetchProfile(user.id).catch(() => null);
      if (cancelled) return;
      if (p) { setProfile(p); return; }
      attempt++;
      timer = setTimeout(tryFetch, Math.min(1000 * 2 ** attempt, 20000));
    };
    // Give the normal boot path a moment to land before the first retry.
    timer = setTimeout(tryFetch, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [user?.id, profile?.id, fetchProfile]);

  const signIn = useCallback(async (usernameOrEmail, password) => {
    if (!supabase) throw new Error('Supabase not configured');
    const email = resolveEmail(usernameOrEmail);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email, password, displayName) => {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName || '' } },
    });
    if (error) throw error;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  }, []);

  const signInWithFacebook = useCallback(async () => {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    // supabase-js contacts the server on signOut even for scope 'local'. A
    // dead session (revoked refresh token) responds 401/403, which the
    // library swallows and still clears storage -- fine. But when the server
    // is unreachable the call errors WITHOUT clearing storage, and it can sit
    // for 25s+ behind an in-flight refresh retry loop that holds the auth
    // lock. A user tapping Sign out must not stare at a dead button: cap the
    // graceful attempt at 3.5s, then clear the Supabase auth keys ourselves
    // and reload to the login screen. (Timing verified by stress/session.spec.mjs.)
    try {
      const capped = new Promise((resolve) => setTimeout(() => resolve({ error: new Error('sign-out timed out') }), 3500));
      const { error } = await Promise.race([supabase.auth.signOut(), capped]);
      if (!error) return;
    } catch { /* fall through to manual clear */ }
    try {
      Object.keys(localStorage)
        .filter(k => /^sb-.+-auth-token/.test(k))
        .forEach(k => localStorage.removeItem(k));
    } catch { /* storage unavailable */ }
    window.location.reload();
  }, []);

  const updateDisplayName = useCallback(async (name) => {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.auth.updateUser({ data: { display_name: name } });
    if (error) throw error;
    // Mirror to the profiles row so other users can read it (auth metadata is private).
    await supabase.rpc('update_own_profile', { p_display_name: name });
    // Force-refresh user state so display name and greeting update immediately.
    const { data } = await supabase.auth.getUser();
    if (data?.user) setUser(data.user);
    setProfile(p => p ? { ...p, display_name: name } : p);
  }, []);

  // Update username / bio / public-visibility on the profiles row via the
  // update_own_profile RPC. Pass only the fields you want to change.
  // Throws on username collision (Postgres unique violation, code 23505).
  const updateProfile = useCallback(async ({ username, bio, isPublic } = {}) => {
    if (!supabase) throw new Error('Supabase not configured');
    if (!user?.id) throw new Error('Not logged in');

    const timeout = (ms, msg) => new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));

    const updates = {};
    if (username !== undefined && username !== null) updates.username = username;
    if (bio !== undefined && bio !== null) updates.bio = bio;
    if (typeof isPublic === 'boolean') updates.is_public = isPublic;

    const { error } = await Promise.race([
      supabase.from('profiles').update(updates).eq('id', user.id),
      timeout(20000, 'Profile save timed out -- check your connection and try again.'),
    ]);
    if (error) {
      if (error.code === '23505') throw new Error('That username is already taken.');
      if (error.code === '23514') throw new Error('Username must be 3-20 characters: lowercase letters, numbers, underscores.');
      throw error;
    }
    const fresh = await Promise.race([fetchProfile(user.id), timeout(12000, 'Could not reload profile.')]);
    if (fresh) setProfile(fresh);
    return fresh;
  }, [user, fetchProfile]);

  // Stores the resized avatar data URL in the profiles table.
  // Optimistic update so the header swaps immediately; DB write is capped at 8 s.
  const updateAvatar = useCallback(async (avatarDataUrl) => {
    if (!supabase) throw new Error('Supabase not configured');
    if (!user?.id) throw new Error('Not logged in');

    setProfile(p => p ? { ...p, avatar_url: avatarDataUrl } : p);

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Avatar sync timed out')), 8000)
    );
    const write = supabase
      .from('profiles')
      .update({ avatar_url: avatarDataUrl })
      .eq('id', user.id);
    const { error } = await Promise.race([write, timeout]);
    if (error) throw error;
  }, [user]);

  // Merges `updates` into the preferences jsonb column and keeps local state in sync.
  // Fire-and-forget safe -- callers can ignore the returned promise.
  const updatePreferences = useCallback(async (updates) => {
    if (!supabase || !user?.id) return;
    const next = { ...(profile?.preferences || {}), ...updates };
    setProfile(p => p ? { ...p, preferences: next } : p);
    await supabase.from('profiles').update({ preferences: next }).eq('id', user.id);
  }, [user, profile]);

  const isAdmin = profile?.role === 'admin';

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return;
    const p = await fetchProfile(user.id);
    if (p) setProfile(p);
  }, [user?.id, fetchProfile]);

  return { user, profile, loading, isAdmin, accessToken, signIn, signUp, signOut, signInWithGoogle, signInWithFacebook, isSupabaseEnabled, updateDisplayName, updateProfile, updateAvatar, updatePreferences, refreshProfile };
}
