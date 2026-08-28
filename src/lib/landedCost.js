// Landed cost: what a record actually costs to get to your door.
//
// The whole point of Trace is that an asking price is not a price. A 55 GBP
// copy in Tokyo and a 62 GBP copy in Bristol are not comparable numbers, and
// sorting by the first one is how people get punished. This module turns an
// asking price plus an origin into a total, and itemises every component so
// the number can be checked rather than trusted.
//
// Pure arithmetic. No network, no model calls, no clock reads except the one
// the caller passes in. That makes it unit-testable, which matters because a
// wrong number here is worse than no number at all.

import { isoFor } from './countryFlag.js';

// ---------------------------------------------------------------------------
// FX
// ---------------------------------------------------------------------------
// A table rather than a live call, deliberately. A live rate that fails leaves
// the card with no number; a table that is a fortnight stale leaves it with a
// number that is a fraction of a percent out, on top of a shipping estimate
// that is far coarser. api/trace.js tries a live ECB fetch first and falls
// back to this, and whichever it used is reported so the card can show it.
//
// Rates are units of the named currency per 1 GBP. Refresh when convenient;
// nothing breaks if they drift, the displayed date just gets older.
export const FX_TO_GBP = {
  GBP: 1,
  EUR: 0.855,
  USD: 0.792,
  JPY: 0.0051,
  AUD: 0.515,
  CAD: 0.575,
  CHF: 0.905,
  SEK: 0.074,
  NZD: 0.472,
  ZAR: 0.043,
  BRL: 0.145,
  MXN: 0.040,
};
export const FX_DATE = '2026-08-01';

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------
// Packed weight, not disc weight: the mailer and stiffeners are most of the
// difference. Shipping tariffs step at bands, so the estimate has to use the
// packed figure or it lands in the wrong band and the total is wrong by more
// than the item price varies.
export const PACKED_GRAMS = {
  '7"': 180,
  '10"': 330,
  '12"': 420,
  LP: 620,
  '2xLP': 1050,
  BOX: 1600,
};

// Discogs format strings are freeform. Read the shape rather than matching a
// fixed vocabulary, and fall back to a 12" single, which is the commonest
// thing this app is pointed at.
export function packedWeight(format = '', descriptions = []) {
  const hay = `${format} ${(descriptions || []).join(' ')}`.toLowerCase();
  const discs = Number((hay.match(/(\d+)\s*[x×]\s*(lp|vinyl|12)/) || [])[1]) || 1;
  if (/\bbox\b|box set/.test(hay)) return PACKED_GRAMS.BOX;
  if (discs >= 2) return Math.round(PACKED_GRAMS.LP + (discs - 1) * 430);
  if (/\b7"|\b7 inch|\bsingle\b(?!.*12)/.test(hay) && !/12/.test(hay)) return PACKED_GRAMS['7"'];
  if (/\b10"|\b10 inch/.test(hay)) return PACKED_GRAMS['10"'];
  if (/\blp\b|album/.test(hay)) return PACKED_GRAMS.LP;
  return PACKED_GRAMS['12"'];
}

// ---------------------------------------------------------------------------
// Corridors
// ---------------------------------------------------------------------------
// A maintained table, not code branches, exactly so that adding a country is a
// row rather than a release. `ship` is in GBP for the band, tracked and
// insured to the level a record seller actually uses.
//
// Bands are upper bounds in grams. The last band is the ceiling; anything over
// it uses the last rate, which under-reads for box sets and is flagged as an
// estimate on the card like everything else here.
const BANDS = [500, 1000, 2000];

export const CORRIDORS = {
  GB: { label: 'United Kingdom', ship: [4.2, 5.8, 8.5], days: [2, 4], domestic: true },
  IE: { label: 'Ireland', ship: [9, 13, 19], days: [4, 9] },
  DE: { label: 'Germany', ship: [10, 14, 21], days: [4, 9] },
  NL: { label: 'Netherlands', ship: [10, 14, 20], days: [4, 8] },
  FR: { label: 'France', ship: [10, 14, 20], days: [4, 9] },
  ES: { label: 'Spain', ship: [11, 15, 22], days: [5, 11] },
  IT: { label: 'Italy', ship: [11, 16, 23], days: [5, 12] },
  BE: { label: 'Belgium', ship: [10, 14, 20], days: [4, 8] },
  SE: { label: 'Sweden', ship: [11, 15, 22], days: [5, 10] },
  CH: { label: 'Switzerland', ship: [13, 18, 26], days: [5, 10] },
  US: { label: 'United States', ship: [16, 24, 38], days: [7, 18] },
  CA: { label: 'Canada', ship: [17, 25, 39], days: [8, 20] },
  JP: { label: 'Japan', ship: [19, 28, 44], days: [8, 18] },
  AU: { label: 'Australia', ship: [20, 30, 47], days: [10, 24] },
  NZ: { label: 'New Zealand', ship: [21, 31, 48], days: [12, 26] },
  ZA: { label: 'South Africa', ship: [18, 27, 42], days: [10, 25] },
  BR: { label: 'Brazil', ship: [19, 29, 45], days: [12, 30] },
};

// Unknown origin: assume the expensive end rather than the cheap one. An
// under-estimate is the failure that costs the user money.
const DEFAULT_CORRIDOR = { label: 'Rest of world', ship: [20, 30, 46], days: [10, 25] };

// Accepts either an ISO code or a Discogs country string ("UK", "Japan",
// "UK, Europe & US"), so callers can pass the release field straight through.
export function corridorFor(country) {
  const raw = String(country || '').trim();
  const code = (CORRIDORS[raw.toUpperCase()] ? raw.toUpperCase() : isoFor(raw)) || '';
  return CORRIDORS[code] || DEFAULT_CORRIDOR;
}

function shippingFor(corridor, grams) {
  const i = BANDS.findIndex(b => grams <= b);
  return corridor.ship[i === -1 ? corridor.ship.length - 1 : i];
}

// ---------------------------------------------------------------------------
// UK import rules
// ---------------------------------------------------------------------------
// Verified against HMRC guidance as of the date below. These are the numbers
// most likely to go stale, so they are named and dated rather than inlined.
export const UK_VAT_RATE = 0.20;
// Sound recordings sit under commodity heading 8523 and attract no duty. Kept
// as a named zero so that the card can say "duty 0.00" rather than omit a line
// and leave the user wondering whether it was forgotten.
export const UK_DUTY_RATE = 0;
// Below this consignment value the seller charges VAT at the point of sale and
// nothing is collected at the border, so no handling fee is raised. Above it,
// VAT is collected on import and the courier adds its fee.
export const UK_VAT_AT_BORDER_THRESHOLD = 135;
export const UK_HANDLING_FEE = 8;
// Typical card FX spread. Applied to the converted item and shipping, not to
// the VAT, which is levied in GBP.
export const FX_SPREAD = 0.025;
export const RULES_DATE = '2026-08-01';

/**
 * @param {object} input
 * @param {number} input.price        asking price, in `currency`
 * @param {string} input.currency     ISO code as Discogs reports it
 * @param {string} input.country      origin country code or Discogs country name
 * @param {number} input.grams        packed weight
 * @param {object} [input.rates]      FX override (live rates), same shape as FX_TO_GBP
 * @returns {object|null} itemised breakdown, or null when the price is unusable
 */
export function landedCost({ price, currency = 'GBP', country = '', grams = PACKED_GRAMS['12"'], rates = null }) {
  if (typeof price !== 'number' || !isFinite(price) || price <= 0) return null;

  const table = rates || FX_TO_GBP;
  const code = (currency || 'GBP').toUpperCase();
  const rate = table[code];
  // An unknown currency is not something to guess at. Returning null puts the
  // card into its "could not price this" state, which is honest, rather than
  // silently pricing yen as if they were pounds.
  if (typeof rate !== 'number' || rate <= 0) return null;

  const corridor = corridorFor(country);
  const item = price * rate;
  const shipping = shippingFor(corridor, grams);
  const goods = item + shipping;

  // The spread is a real cost and everybody forgets it, so it is a line.
  const fxSpread = corridor.domestic ? 0 : goods * FX_SPREAD;

  const duty = goods * UK_DUTY_RATE;

  let vat = 0;
  let handling = 0;
  let vatAtBorder = false;
  if (!corridor.domestic) {
    // VAT is charged on goods plus shipping plus duty, whichever side of the
    // threshold it is collected on. The threshold changes WHERE it is paid and
    // therefore whether a handling fee lands, not WHETHER it is paid at all.
    vat = (goods + duty) * UK_VAT_RATE;
    vatAtBorder = item > UK_VAT_AT_BORDER_THRESHOLD;
    if (vatAtBorder) handling = UK_HANDLING_FEE;
  }

  const round = n => Math.round(n * 100) / 100;
  const total = item + shipping + fxSpread + duty + vat + handling;

  return {
    total: round(total),
    currency: 'GBP',
    askingPrice: round(price),
    askingCurrency: code,
    rate,
    ratesDate: rates ? null : FX_DATE,
    domestic: !!corridor.domestic,
    vatAtBorder,
    grams,
    corridor: corridor.label,
    daysMin: corridor.days[0],
    daysMax: corridor.days[1],
    // Ordered for display. Zero lines are kept so that the arithmetic on screen
    // adds up and nothing looks omitted.
    lines: [
      { label: 'Item', value: round(item), note: code === 'GBP' ? null : `${round(price)} ${code}` },
      { label: 'Shipping', value: round(shipping), note: `${corridor.label}, ${grams}g` },
      { label: 'FX spread', value: round(fxSpread), note: fxSpread ? '2.5% card rate' : 'none, domestic' },
      { label: 'Duty', value: round(duty), note: 'sound recordings, 0%' },
      { label: 'Import VAT', value: round(vat), note: corridor.domestic ? 'included in price' : (vatAtBorder ? '20%, collected at the border' : '20%, charged by the seller') },
      { label: 'Handling fee', value: round(handling), note: vatAtBorder ? 'courier clearance' : 'none, under the £135 threshold' },
    ],
  };
}

// Time to hand and quality of recourse are the two axes an asking price hides,
// so they are computed here rather than left for the card to invent.
// Takes an ISO code or a Discogs country name, like corridorFor, because the
// callers hold the release field and normalising in two places is how the two
// disagree about the same pressing.
const FAIR_RECOURSE = new Set(['IE', 'DE', 'NL', 'FR', 'ES', 'IT', 'BE', 'SE', 'CH', 'AT', 'DK', 'PT', 'PL', 'FI']);

export function recourseScore(country) {
  const raw = String(country || '').trim();
  // isoFor first, not the two-letter shortcut. Discogs' own vocabulary contains
  // two-letter strings that are not ISO codes -- "UK" is the commonest country
  // in a British collection and is not "GB" -- so treating a short string as a
  // code would rate every domestic purchase as unreturnable.
  const c = isoFor(raw) || (/^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : '');
  if (c === 'GB') return { level: 'strong', note: 'UK consumer rights, cheap to return' };
  if (FAIR_RECOURSE.has(c)) return { level: 'fair', note: 'returnable, postage is on you' };
  return { level: 'weak', note: 'returning it costs more than most records' };
}
