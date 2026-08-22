// Price ID to tier, resolved once for both the checkout and the webhook.
//
// These used to be two copies of the same object in two files, built from
// STRIPE_PRICE_* while the pricing screen sent IDs from VITE_STRIPE_PRICE_*.
// Two variables holding one value is a launch-day trap: if the server set is
// missing, stale, or still test-mode, every checkout answers "Unknown price"
// and nobody can pay. Both names are read here, so setting either is enough.
const TIER_ENV = {
  selector: ['STRIPE_PRICE_SELECTOR_YEAR', 'STRIPE_PRICE_SELECTOR_FOUNDING'],
  resident: ['STRIPE_PRICE_RESIDENT_YEAR'],
};

// STRIPE_PRICE_X, else VITE_STRIPE_PRICE_X. Vercel exposes VITE_ vars to
// functions as well as the browser, so the client's set works server-side.
function priceId(name) {
  return process.env[name] || process.env[`VITE_${name}`] || null;
}

// { priceId: tier }. Unset variables are skipped rather than becoming an
// "undefined" key, which would otherwise match a request with no price.
export function priceToTier() {
  const map = {};
  for (const [tier, names] of Object.entries(TIER_ENV)) {
    for (const name of names) {
      const id = priceId(name);
      if (id) map[id] = tier;
    }
  }
  return map;
}

// True when no price is configured at all. That is a broken deployment, not a
// bad request, and callers should say so rather than blaming the price sent.
export function pricingConfigured() {
  return Object.keys(priceToTier()).length > 0;
}

export function tierForPrice(id) {
  return id ? (priceToTier()[id] || null) : null;
}
