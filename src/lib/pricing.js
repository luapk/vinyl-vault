// Pricing constants -- single source of truth for all tier logic.
// Currency: GBP. Billing: annual.

export const PRICE_SELECTOR_YEAR  = 18;
export const PRICE_RESIDENT_YEAR  = 39;
export const PRICE_FOUNDING       = 59;
export const FOUNDING_SEATS       = 500;
export const FREE_SCANS           = 30;
export const FREE_LABELS          = 25;
export const FAIR_USE_SCANS_YEAR  = 10_000;
export const SCAN_RATE_PER_MIN    = 60;
export const VISION_MODEL         = 'gemini-2.5-flash-lite';

export const TIERS = {
  DIGGER:   'digger',
  SELECTOR: 'selector',
  RESIDENT: 'resident',
};

// localStorage key that tracks whether the user has seen and dismissed pricing.
export const PRICING_SEEN_KEY = 'vv_pricing_seen';
