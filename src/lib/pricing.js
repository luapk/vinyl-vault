// Pricing constants -- single source of truth for all tier logic.
// Currency: GBP. Billing: annual.

export const PRICE_SELECTOR_YEAR  = 18;
// Resident carries Trace, which is a purchasing tool with a cost per hunt
// rather than a catalogue feature, so it is priced against the mistake it
// prevents rather than against collection apps. Anyone already on Resident
// keeps their price and gets Trace; this is the number new subscribers see.
export const PRICE_RESIDENT_YEAR  = 79;
export const PRICE_FOUNDING       = 59;
export const FOUNDING_SEATS       = 500;
export const FREE_SCANS           = 30;
// NOT ENFORCED. This was on the pricing card as a Digger cap and no code ever
// checked it, so label printing has always been unlimited for everyone. Kept
// only as the number to use if a cap is ever actually built; nothing reads it
// today, and the tier copy no longer claims it.
export const FREE_LABELS          = 25;
export const FAIR_USE_SCANS_YEAR  = 10_000;
export const SCAN_RATE_PER_MIN    = 60;
// The model the scan pipeline actually calls (api/lib/vision.js). It said
// gemini-2.5-flash-lite for a long time after the pipeline moved to Claude,
// which is harmless while nothing reads it and wrong the moment something
// prices a scan off it, so it is kept honest here.
export const VISION_MODEL         = 'claude-sonnet-4-6';

export const TIERS = {
  DIGGER:   'digger',
  SELECTOR: 'selector',
  RESIDENT: 'resident',
};

// ---------------------------------------------------------------------------
// What each tier buys
// ---------------------------------------------------------------------------
// One table, read by the client gates, the server gates and the pricing screen
// alike. Keeping it in three places is how a tier ends up selling something it
// does not enforce, which is exactly what happened with label printing and CSV
// export: both were on the Selector card and neither was ever checked.
//
// A feature absent from this map is free to everyone. That is the default on
// purpose: a gate should have to be written down.
export const FEATURE_TIER = {
  scanUnlimited: TIERS.SELECTOR,
  wishlist:      TIERS.SELECTOR,
  smartCrates:   TIERS.SELECTOR,
  bpmSorter:     TIERS.RESIDENT,
  trace:         TIERS.RESIDENT,
};

// What the admin panel shows beside each switch. A gate the admin can move is
// a gate somebody has to understand first: where it is enforced decides
// whether moving it is safe, so the panel says so rather than assuming the
// person moving it remembers.
export const FEATURE_META = {
  scanUnlimited: { label: 'Unlimited scans',   enforced: 'server', where: 'api/scan.js',         note: 'Free tier is capped at ' + FREE_SCANS + ' scans a month.' },
  wishlist:      { label: 'Wishlist tab',      enforced: 'client', where: 'nav gate',            note: 'A view over data the user already owns.' },
  smartCrates:   { label: 'Smart crates',      enforced: 'server', where: 'api/smart-crates.js', note: 'Sends up to 2MB to Claude and asks 8192 tokens back.' },
  bpmSorter:     { label: 'BPM sorter',        enforced: 'client', where: 'Tracks tab gate',     note: 'A view over data the user already owns.' },
  trace:         { label: 'Trace',             enforced: 'server', where: 'api/trace.js',        note: 'Three or four Discogs requests a hunt.' },
};

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------
// The map above is the shipped default. `public.feature_tiers` can move a
// single feature without a deploy, which is what the admin panel writes to,
// and both the client gates and the server gates read the same override.
//
// It is layered rather than replacing, deliberately: a feature nobody has
// overridden keeps the value in the file, so an empty (or unreachable) table
// leaves the product exactly as shipped rather than opening everything up.
// 'free' means no gate at all, which is the one thing the code map cannot say.
let tierOverrides = {};

export function setFeatureTierOverrides(map) {
  const next = {};
  for (const [feature, tier] of Object.entries(map || {})) {
    if (typeof tier === 'string') next[feature] = tier;
  }
  tierOverrides = next;
}

export function featureTierOverrides() {
  return { ...tierOverrides };
}

/** The tier a feature actually requires right now. null means free to all. */
export function effectiveFeatureTier(feature) {
  const override = tierOverrides[feature];
  if (override) return override === 'free' ? null : override;
  return FEATURE_TIER[feature] || null;
}

export const TIER_RANK = { [TIERS.DIGGER]: 0, [TIERS.SELECTOR]: 1, [TIERS.RESIDENT]: 2 };

/**
 * Does this tier reach the feature?
 *
 * `isActive` false means a lapsed or cancelled subscriber, who is a free user
 * rather than an exempt one. That distinction has bitten before: the scan limit
 * used to be skipped unless the subscription was active, so cancelling granted
 * unlimited scans.
 */
export function tierAllows(feature, tier, isActive = true) {
  const required = effectiveFeatureTier(feature);
  if (!required) return true;
  const effective = isActive ? (tier || TIERS.DIGGER) : TIERS.DIGGER;
  return (TIER_RANK[effective] ?? 0) >= (TIER_RANK[required] ?? 0);
}

// localStorage key that tracks whether the user has seen and dismissed pricing.
export const PRICING_SEEN_KEY = 'vv_pricing_seen';
