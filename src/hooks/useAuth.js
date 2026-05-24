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
      .select('id, email, role, avatar_url')
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
    // Force-refresh user state so display name and greeting update immediately.
    const { data } = await supabase.auth.getUser();
    if (data?.user) setUser(data.user);
  }, []);

  // Uploads avatar to Supabase Storage and stores ONLY the public URL in
  // user_metadata. Inline data URLs in user_metadata bloat the JWT and silently
  // fail to persist above a soft size limit, which is why this needs Storage.
  // Requires the avatars bucket and policies in supabase/storage.sql.
  const updateAvatar = useCallback(async (avatarDataUrl) => {
    if (!supabase) throw new Error('Supabase not configured');
    if (!user?.id) throw new Error('Not logged in');
    const userId = user.id;
    const path = `${userId}/avatar.jpg`;

    // Removal: clear metadata and delete the storage object.
    if (avatarDataUrl === null) {
      setUser(u => u ? { ...u, user_metadata: { ...u.user_metadata, avatar_url: null } } : u);
      const { error: authErr } = await supabase.auth.updateUser({ data: { avatar_url: null } });
      if (authErr) throw authErr;
      supabase.storage.from('avatars').remove([path]).catch(() => {});
      return;
    }

    // Upload data URL as a blob to Storage.
    const blob = await (await fetch(avatarDataUrl)).blob();
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) {
      throw new Error(
        `Avatar upload failed: ${uploadError.message}. ` +
        `If you have not set up the avatars bucket yet, run the SQL in supabase/storage.sql.`
      );
    }

    // Cache-bust so the browser refetches the new image (same path is reused).
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // Optimistic state update so the header swaps immediately.
    setUser(u => u ? { ...u, user_metadata: { ...u.user_metadata, avatar_url: publicUrl } } : u);

    // Persist the URL to auth metadata so it survives across sessions.
    const { error: authError } = await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });
    if (authError) throw authError;
  }, [user]);

  const isAdmin = profile?.role === 'admin';

  return { user, profile, loading, isAdmin, signIn, signUp, signOut, signInWithGoogle, signInWithFacebook, isSupabaseEnabled, updateDisplayName, updateAvatar };
}
