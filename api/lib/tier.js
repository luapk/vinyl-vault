import { createClient } from '@supabase/supabase-js';
import { tierAllows, setFeatureTierOverrides } from '../../src/lib/pricing.js';

// Server-side tier gating.
//
// Hiding a button is not a gate. Every endpoint here spends something real,
// model tokens or third-party rate limit, so the check has to happen before the
// spending does and it has to happen where the client cannot reach it. The
// tier map itself lives in src/lib/pricing.js and is shared with the client, so
// what is sold and what is enforced cannot drift apart.

let cachedAdmin = null;
function admin() {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  return cachedAdmin;
}

// Stripe gives a grace period on a failed payment, so past_due still has
// access. Anything else without a status is treated as active, which is the
// state a comped or pre-Stripe account sits in.
const ACTIVE = new Set(['active', 'trialing', 'past_due']);

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------
// public.feature_tiers can move a feature between tiers without a deploy (the
// admin panel writes it). Read here, cached per warm instance for a minute, so
// a gate check does not cost two round trips.
//
// Failure leaves the shipped map in place rather than clearing it. That is the
// safe direction: a table we cannot read must not quietly turn every paid
// feature free, which is exactly what replacing-on-load would do the first
// time this query timed out.
const OVERRIDE_TTL_MS = 60 * 1000;
let overridesAt = 0;

export async function refreshFeatureOverrides() {
  if (Date.now() - overridesAt < OVERRIDE_TTL_MS) return;
  try {
    const { data, error } = await admin().from('feature_tiers').select('feature, tier');
    if (error) throw new Error(error.message);
    const map = {};
    for (const row of data || []) map[row.feature] = row.tier;
    setFeatureTierOverrides(map);
    overridesAt = Date.now();
  } catch {
    // Keep whatever is loaded (the shipped map, or the last good read) and try
    // again on the next call rather than pinning the failure for a minute.
  }
}

/**
 * Answers 402 and returns null when the caller's tier does not reach `feature`.
 * Returns { tier, isActive } when it does.
 */
export async function requireTier(feature, userId, res) {
  await refreshFeatureOverrides();

  const { data: profile, error } = await admin()
    .from('profiles')
    .select('subscription_tier, subscription_status')
    .eq('id', userId)
    .single();

  // A profile we cannot read is not permission to proceed. Failing open here
  // would make an unreachable database the cheapest way to use a paid feature.
  if (error || !profile) {
    res.status(503).json({ error: 'Could not check your subscription. Try again in a moment.' });
    return null;
  }

  const tier = profile.subscription_tier || 'digger';
  const isActive = !profile.subscription_status || ACTIVE.has(profile.subscription_status);

  if (!tierAllows(feature, tier, isActive)) {
    res.status(402).json({ error: `${feature}_requires_upgrade`, feature, tier });
    return null;
  }
  return { tier, isActive };
}
