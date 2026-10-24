import { useState, useEffect } from 'react';

// Which third-party sign-in providers this Supabase project actually has
// switched on.
//
// Offering a provider that is not enabled is worse than not offering it.
// signInWithOAuth navigates the whole page to Supabase's authorize endpoint,
// so when the provider is off the user does not get an error inside the app
// that we could catch and explain: they land on a raw JSON 400 on a Supabase
// domain, with no header, no back button and nothing to tell them the app
// still works. That is what happened the first time somebody tried
// "Continue with Google" on a project where Google had never been configured.
//
// /auth/v1/settings is GoTrue's own public description of itself and lists
// every external provider as a boolean, so the screen can ask rather than
// assume.
//
// It fails in the SHOWING direction on purpose. A definitive false hides the
// button; a network failure, a slow answer or a shape we do not recognise
// leaves it visible, exactly as before. Hiding on uncertainty would lock out
// anyone whose only account is a Google account the moment this request
// wobbled, which is a far worse outcome than the dead end it guards against.
export function useAuthProviders() {
  // null means "not known yet", which is distinct from false.
  const [providers, setProviders] = useState({ google: null });

  useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    if (!url) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${url}/auth/v1/settings`, {
          headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '' },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return;
        const data = await res.json();
        const external = data?.external;
        if (cancelled || !external || typeof external !== 'object') return;
        // Only a boolean counts. A missing key is not a disabled provider.
        if (typeof external.google === 'boolean') {
          setProviders(p => ({ ...p, google: external.google }));
        }
      } catch {
        // Offline, slow, or blocked. Leave the buttons as they are.
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return providers;
}
