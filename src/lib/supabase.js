import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// When env vars are absent (local dev without Supabase) expose a null client
// so the rest of the app can gracefully fall back to localStorage.
export const supabase = (url && key) ? createClient(url, key) : null;

export const isSupabaseEnabled = !!(url && key);
