import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseEnabled } from '../lib/supabase';

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

  const fetchProfile = useCallback(async (userId) => {
    if (!supabase || !userId) return null;
    const { data } = await supabase
      .from('profiles')
      .select('id, email, role, avatar_url, display_name, username, bio, is_public')
      .eq('id', userId)
      .single();
    return data || null;
  }, []);

  useEffect(() => {
    if (!isSupabaseEnabled) { setLoading(false); return; }

    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000));
    Promise.race([supabase.auth.getSession(), timeout])
      .then(async ({ data: { session } }) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          const p = await fetchProfile(session.user.id);
          setProfile(p);
        }
        setLoading(false);
      }).catch(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          const p = await fetchProfile(session.user.id);
          setProfile(p);
        } else {
          setProfile(null);
        }
      }
    );
    return () => subscription.unsubscribe();
  }, [fetchProfile]);

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
    await supabase.auth.signOut();
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

    const { error } = await Promise.race([
      supabase.rpc('update_own_profile', {
        p_username: username ?? null,
        p_bio: bio ?? null,
        p_is_public: typeof isPublic === 'boolean' ? isPublic : null,
      }),
      timeout(10000, 'Profile save timed out -- check your connection and try again.'),
    ]);
    if (error) {
      if (error.code === '23505') throw new Error('That username is already taken.');
      if (error.code === '23514') throw new Error('Username must be 3-20 characters: lowercase letters, numbers, underscores.');
      throw error;
    }
    const fresh = await Promise.race([fetchProfile(user.id), timeout(8000, 'Could not reload profile.')]);
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

  const isAdmin = profile?.role === 'admin';

  return { user, profile, loading, isAdmin, signIn, signUp, signOut, signInWithGoogle, signInWithFacebook, isSupabaseEnabled, updateDisplayName, updateProfile, updateAvatar };
}
