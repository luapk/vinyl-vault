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
function buildVerdict({ price, versions, cost, condition }) {
  const notes = [];
  let stance = 'watch';
  let headline = 'Not enough to go on yet';

  if (!cost) {
    notes.push('No live listing to price. The condition ladder below is what Discogs has sold this for.');
    return { stance: 'cold', headline: 'Nothing for sale right now', notes };
  }

  const listings = price?.totalListings || 0;
  // The suggestion ladder is what Discogs has actually SOLD copies for, so the
  // gap between it and the cheapest live listing is the only "is this a deal"
  // signal available without scraping.
  const vgPlus = condition.find(c => c.grade === 'VG+') || condition.find(c => c.grade === 'NM');
  const benchmark = vgPlus?.value ?? null;

  if (listings === 0) {
    stance = 'cold';
    headline = 'No copies listed today';
    notes.push('Nothing is for sale on Discogs at the moment. Worth watching rather than chasing.');
  } else if (listings <= 3) {
    stance = 'scarce';
    headline = `Only ${listings} cop${listings === 1 ? 'y' : 'ies'} listed`;
    notes.push('Thin supply. The price is whatever the few sellers say it is, and it moves when one sells.');
  } else if (listings >= 40) {
    stance = 'common';
    headline = `${listings} copies listed`;
    notes.push('Common enough that waiting costs you nothing. There is no rush on this one.');
  } else {
    stance = 'steady';
    headline = `${listings} copies listed`;
  }

  if (benchmark != null && cost.total > 0) {
    const delta = Math.round((cost.total - benchmark) * 100) / 100;
    if (delta > benchmark * 0.25) {
      notes.push(`Landed, the cheapest copy works out ${fmt(delta)} above what a VG+ usually sells for.`);
    } else if (delta < -benchmark * 0.15) {
      notes.push(`Landed, the cheapest copy is ${fmt(-delta)} under the usual VG+ price.`);
    }
  }

  if (!cost.domestic) {
    const added = Math.round((cost.total - cost.lines[0].value) * 100) / 100;
    notes.push(`Getting it here adds ${fmt(added)} to the asking price, and ${cost.daysMin} to ${cost.daysMax} days.`);
    if (cost.vatAtBorder) {
      notes.push('Over the £135 threshold, so VAT is collected at the border and a courier handling fee lands with it.');
    }
  }

  const recourse = recourseScore(cost.corridorCode);
  if (recourse.level === 'weak') {
    notes.push('If it turns up wrong, returning it costs more than most records are worth.');
  }

  if (versions?.total > 1) {
    notes.push(`${versions.total} pressings exist. Check the one you are buying is the one you want.`);
  }

  return { stance, headline, notes };
}

function fmt(n) {
  return `£${Math.abs(n).toFixed(2)}`;
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

  // The floor is the cheapest ACTIVE listing. It is the only number here that
  // describes a copy somebody can actually buy today, so it is what gets
  // landed. Everything else on the card is context around it.
  const cost = price?.floor
    ? landedCost({
        price: price.floor.value,
        currency: price.floor.currency,
        country: release.country,
        grams,
        rates: fx.rates,
      })
    : null;

  if (cost) {
    cost.corridorCode = release.country || null;
    cost.fxLive = fx.live;
    cost.fxDate = fx.live ? fx.date : cost.ratesDate;
  }

  const verdict = buildVerdict({ price, versions, cost, condition });

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
