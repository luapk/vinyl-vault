// Trace: what this record actually costs, and which pressing you are buying.
//
// SCOPE, AND WHY IT IS THIS SHAPE
// This runs on Discogs endpoints the app is permitted to use: the release
// document, the versions list off its master, marketplace stats and price
// suggestions. It does not scrape marketplaces, it does not hold a copy of the
// Discogs database, and it makes no model calls. Everything below is a fetch
// or arithmetic.
//
// That constraint is not a compromise, it is what makes the answer defensible.
// Every number the card shows can be traced to a named source and a timestamp,
// which is the difference between a price comparison and a claim about
// somebody's money.
//
// WHAT IT DELIBERATELY DOES NOT SAY
// Discogs reports the country a pressing was MADE in, not where the copy for
// sale sits. The landed cost is therefore an estimate anchored on the likely
// origin, and every surface that prints it has to say so. Asserting a total to
// the penny off a country of manufacture would be the same mistake as sorting
// by asking price, one layer up.

import { fetchDiscogsRelease, fetchDiscogsPrice, fetchMasterVersions } from './discogs.js';
import { landedCost, packedWeight, recourseScore, FX_TO_GBP } from '../../src/lib/landedCost.js';

// ---------------------------------------------------------------------------
// FX
// ---------------------------------------------------------------------------
// The built-in table is the floor. If a live rate is reachable we use it and
// say so; if not, the table carries the card and the card prints its date.
// Cached per warm instance for a day: rates move by fractions of a percent and
// a per-hunt fetch would be the slowest thing in the pipeline.
const FX_TTL_MS = 24 * 60 * 60 * 1000;
let fxCache = null;

async function liveRates() {
  if (fxCache && Date.now() - fxCache.at < FX_TTL_MS) return fxCache;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const symbols = Object.keys(FX_TO_GBP).filter(c => c !== 'GBP').join(',');
    const res = await fetch(
      `https://api.frankfurter.dev/v1/latest?base=GBP&symbols=${symbols}`,
      { signal: controller.signal },
    ).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`fx ${res.status}`);
    const data = await res.json();
    // Frankfurter quotes units of X per 1 GBP; landedCost wants GBP per 1 X.
    const rates = { GBP: 1 };
    for (const [code, perGbp] of Object.entries(data.rates || {})) {
      if (typeof perGbp === 'number' && perGbp > 0) rates[code] = 1 / perGbp;
    }
    if (Object.keys(rates).length < 3) throw new Error('fx payload too thin');
    fxCache = { rates, date: data.date || null, live: true, at: Date.now() };
    return fxCache;
  } catch {
    // Not an error worth surfacing. The table is a valid answer.
    return { rates: null, date: null, live: false, at: Date.now() };
  }
}

// Discogs' grade codes, spelled out. "NM" means nothing to somebody buying
// their fortieth record, let alone their fourth.
const GRADE_NAMES = {
  M: 'Mint', NM: 'Near Mint', 'VG+': 'Very Good Plus', VG: 'Very Good',
  'G+': 'Good Plus', G: 'Good', F: 'Fair', P: 'Poor',
};

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------
// Deterministic, not generated. A model call here would cost money on every
// hunt, add a second of latency, and produce a sentence nobody can check. The
// inputs are four numbers; the reasoning is a handful of thresholds; and
// writing it out means the thresholds can be argued with.
//
// Never asserts authenticity, never says "this is an original", never tells
// the user to buy. It reports what the market looks like and what it will cost.
function buildVerdict({ price, versions, cost, condition, floorCost }) {
  const notes = [];

  if (!cost) {
    return {
      stance: 'cold',
      headline: 'Nothing for sale right now',
      notes: ['No live listing to price. The ladder below is what Discogs has sold this for.'],
    };
  }

  const listings = price?.totalListings || 0;
  let stance = 'steady';
  let headline = `${listings} listed`;

  // Supply judgement. This is the one thing on the card that is an opinion
  // rather than a number, so it is the one thing worth spending a line on.
  if (listings === 0) {
    stance = 'cold';
    headline = 'None listed';
    notes.push('Nothing for sale today. Worth watching rather than chasing.');
  } else if (listings <= 3) {
    stance = 'scarce';
    notes.push('Thin supply. The price is whatever these few sellers say, and it moves when one sells.');
  } else if (listings >= 40) {
    stance = 'common';
    notes.push('Common enough that waiting costs you nothing.');
  }

  // Everything else the card already SHOWS: the landed total, the cheapest
  // listed copy, the transit window, the recourse, the split between the record
  // and the freight. Restating any of it in prose was making the panel twice as
  // long as the information in it. A note earns its place only by saying
  // something no figure on the card says.
  if (versions?.total > 1) {
    notes.push(`${versions.total} pressings exist. Check the one you are buying is the one you want.`);
  }
  if (cost.vatAtBorder) {
    notes.push('Over the £135 threshold, so VAT is collected at the border and the courier adds its fee.');
  }

  const benchmark = (condition.find(c => c.grade === 'VG+') || condition.find(c => c.grade === 'NM'))?.value ?? null;
  if (benchmark != null && floorCost?.total > 0 && floorCost.total > benchmark * 1.25) {
    notes.push(`Even the cheapest copy lands above what a VG+ usually sells for.`);
  }

  return { stance, headline, notes: notes.slice(0, 2) };
}

// ---------------------------------------------------------------------------
// The hunt
// ---------------------------------------------------------------------------
/**
 * @param {string|number} releaseId
 * @returns {Promise<object>} the payload stored against a wishlist item
 */
export async function runTrace(releaseId) {
  const startedAt = Date.now();

  // The release document first: everything else keys off its master and its
  // format. Price and versions then run together, since neither needs the other.
  const release = await fetchDiscogsRelease(releaseId);

  const [price, versions, fx] = await Promise.all([
    fetchDiscogsPrice(releaseId).catch(() => null),
    fetchMasterVersions(release.masterId).catch(() => null),
    liveRates(),
  ]);

  const grams = packedWeight(release.format, release.formatDescriptions);
  const condition = price?.conditions || [];

  // WHICH PRICE GETS LANDED, AND WHY IT CARRIES A GRADE
  //
  // Two numbers are available and they answer different questions.
  //
  //   `floor` is the cheapest ACTIVE listing. It is a copy somebody can buy
  //   today, but Discogs' stats endpoint reports no condition with it, so
  //   nobody can say what state that copy is in. A price with no grade beside
  //   it is how you end up paying 40 quid for a record that crackles.
  //
  //   The suggestion ladder is per-grade and comes from real sales history, so
  //   a figure on it can be labelled honestly. The headline number is the best
  //   grade the ladder actually carries, Mint first, and it is shown WITH that
  //   grade. It is what a clean copy costs, not what the cheapest copy costs.
  //
  // Both are landed and both are returned. The card leads with the graded one
  // and keeps the floor beside it, because the gap between them is the thing a
  // buyer is actually deciding about.
  const land = (value, currency) => {
    if (typeof value !== 'number' || !(value > 0)) return null;
    const out = landedCost({ price: value, currency, country: release.country, grams, rates: fx.rates });
    if (out) {
      out.corridorCode = release.country || null;
      out.fxLive = fx.live;
      out.fxDate = fx.live ? fx.date : out.ratesDate;
    }
    return out;
  };

  // Best grade first. The ladder from fetchDiscogsPrice is already ordered that
  // way, so the first entry is the cleanest copy it has a figure for.
  const best = condition[0] || null;
  const cost = best ? land(best.value, price.currency) : null;
  if (cost) {
    cost.grade = best.grade;
    // Never let the card imply this is a listing. It is what copies in this
    // grade have sold for, which is a different claim.
    cost.gradeNote = `estimated for a ${GRADE_NAMES[best.grade] || best.grade} copy`;
  }

  const floorCost = price?.floor ? land(price.floor.value, price.floor.currency) : null;

  if (cost) {
    // The split the card visualises: what you pay for the record, and what you
    // pay to have it. Everything that is not the record is friction, and seeing
    // the ratio is the point -- a 20 quid record with 30 quid of freight on it
    // is a different proposition from the same total the other way round.
    const item = cost.lines.find(l => l.label === 'Item')?.value || 0;
    const friction = Math.round((cost.total - item) * 100) / 100;
    cost.split = {
      item,
      friction,
      // Named parts of the friction, for the one line under the legend. Zero
      // rows are dropped: a fee that was not charged is not information.
      parts: cost.lines
        .filter(l => l.label !== 'Item' && l.value > 0)
        .map(l => ({ label: l.label, value: l.value })),
    };
  }

  const verdict = buildVerdict({ price, versions, cost: cost || floorCost, condition, floorCost });

  return {
    releaseId: String(releaseId),
    release: {
      artist: release.artist,
      title: release.title,
      label: release.label,
      catalogNumber: release.catalogNumber,
      year: release.year,
      country: release.country,
      format: release.format,
      coverUrl: release.coverUrl,
      masterId: release.masterId,
    },
    market: {
      totalListings: price?.totalListings ?? 0,
      floor: price?.floor || null,
      conditions: condition,
      suggestionsStatus: price?.suggestionsStatus || 'unknown',
    },
    pressings: versions
      ? { total: versions.total, byCountry: versions.byCountry.slice(0, 6) }
      : { total: 1, byCountry: release.country ? [{ country: release.country, n: 1 }] : [] },
    cost,
    floorCost,
    recourse: recourseScore(release.country),
    verdict,
    // Sources, named, so the card can attribute every figure on it. The house
    // rule is that every claim is evidenced on screen; this is the evidence.
    sources: [
      'Discogs release',
      versions ? 'Discogs master versions' : null,
      price?.floor ? 'Discogs marketplace stats' : null,
      condition.length ? 'Discogs price suggestions' : null,
      cost ? (fx.live ? `ECB rates ${fx.date || ''}`.trim() : 'Built-in FX table') : null,
    ].filter(Boolean),
    grams,
    tookMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  };
}
