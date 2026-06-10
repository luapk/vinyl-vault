import { useCallback } from 'react';
import { supabase } from '../lib/supabase.js';

export function useSubscription(user, profile) {
  const tier   = profile?.subscription_tier   || 'digger';
  const status = profile?.subscription_status || 'active';
  const scansUsed   = profile?.scans_this_period || 0;
  const scansPeriodEnd = profile?.scans_period_end || null;

  const LIMITS = { digger: 50, selector: Infinity, resident: Infinity };
  const scanLimit = LIMITS[tier] ?? LIMITS.digger;
  const isPaid = tier === 'selector' || tier === 'resident';
  const isActive = status === 'active' || status === 'trialing' || status === 'past_due';
  const scansRemaining = isPaid ? Infinity : Math.max(0, scanLimit - scansUsed);

  const startCheckout = useCallback(async (priceId) => {
    if (!user?.id) throw new Error('Not logged in');
    const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } };
    const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` };
    const res = await fetch('/api/stripe-checkout', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ priceId, userEmail: user.email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Checkout failed');
    window.location.href = data.url;
  }, [user]);

  const openPortal = useCallback(async () => {
    if (!user?.id) throw new Error('Not logged in');
    const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } };
    const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` };
    const res = await fetch('/api/stripe-portal', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Portal failed');
    window.location.href = data.url;
  }, [user]);

  return { tier, status, isActive, isPaid, scanLimit, scansUsed, scansRemaining, scansPeriodEnd, startCheckout, openPortal };
}
