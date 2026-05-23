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
      .select('id, email, role, display_name')
      .eq('id', userId)
      .single();
    return data || null;
  }, []);

  useEffect(() => {
    if (!isSupabaseEnabled) { setLoading(false); return; }

    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000));
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
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    if (data?.user && displayName) {
      await supabase.from('profiles').upsert({ id: data.user.id, email, display_name: displayName });
    }
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

  const isAdmin = profile?.role === 'admin';

  return { user, profile, loading, isAdmin, signIn, signUp, signOut, signInWithGoogle, signInWithFacebook, isSupabaseEnabled };
}
