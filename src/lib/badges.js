// Collection milestones: a space-flight ladder that rewards digging.
//
// The ladder is deliberately front-loaded (50, 100, 200) so a new collector
// hits something early, then stretches out to 5,000 so there is always a next
// one visible. Everything above the current count renders greyed out in the
// account panel, which is the point: the locked half of the grid is the
// reward for carrying on.
//
// The count is the size of the collection, not a separate scan counter. It is
// the number the user can see and trust, it survives a reinstall (it comes
// back with the cloud load), and imports count too, which is the fair reading
// of "records in the vault".

import { safeSetItem } from './localCache.js';
import { passportStamp } from './countryFlag.js';

// icon names resolve against SPACE_ICONS in avatarIcon.js at render time, so
// this module stays free of React imports and can be unit tested in node.
export const BADGE_TIERS = [
  { count: 50,   name: 'Lift Off',        icon: 'Rocket',       line: 'Fifty in the racks. You are off the ground.' },
  { count: 100,  name: 'Escape Velocity', icon: 'RocketLaunch', line: 'One hundred records. Gravity has stopped arguing.' },
  { count: 200,  name: 'In Orbit',        icon: 'Planet',       line: 'Two hundred sleeves circling the deck.' },
  { count: 350,  name: 'Night Side',      icon: 'MoonStars',    line: 'Three hundred and fifty. The deep listening hours.' },
  { count: 500,  name: 'Meteor Run',      icon: 'Meteor',       line: 'Five hundred, and still burning through the crates.' },
  { count: 1000, name: 'First Contact',   icon: 'FlyingSaucer', line: 'One thousand records. People ask where you find them.' },
  { count: 2000, name: 'Signal Received', icon: 'Alien',        line: 'Two thousand. The collection has its own gravity now.' },
  { count: 3500, name: 'Supernova',       icon: 'Star',         line: 'Three thousand five hundred sleeves of pure output.' },
  { count: 5000, name: 'Heliosphere',     icon: 'Sun',          line: 'Five thousand. The centre of your own system.' },
];

export const FINAL_TIER = BADGE_TIERS[BADGE_TIERS.length - 1];

// ----- pure helpers ----------------------------------------------------------

// Tiers the collection size alone has earned.
export function earnedTiers(count) {
  return BADGE_TIERS.filter(t => count >= t.count);
}

// The top tier a collection size alone has earned, or null below the first
// milestone. Derived purely from the count, which is what makes it usable on
// somebody else's profile: their ledger is on their device, but their record
// count is public.
export function highestEarned(count) {
  const earned = earnedTiers(count);
  return earned.length ? earned[earned.length - 1] : null;
}

// What the grid shows as unlocked. The ledger is unioned in so a badge, once
// won, is never taken away again: deleting records is housekeeping, not a
// demotion.
export function unlockedCounts(count, celebrated = []) {
  const earned = new Set(earnedTiers(count).map(t => t.count));
  for (const c of celebrated) earned.add(c);
  return earned;
}

// The tier being worked towards, or null once the ladder is finished.
export function nextTier(count, celebrated = []) {
  const unlocked = unlockedCounts(count, celebrated);
  return BADGE_TIERS.find(t => !unlocked.has(t.count)) || null;
}

// 0..1 towards `tier`, measured from the tier below it so each step reads as a
// fresh climb rather than a bar that barely moves near the top of the ladder.
export function progressToward(count, tier) {
  if (!tier) return 1;
  const idx = BADGE_TIERS.indexOf(tier);
  const floor = idx > 0 ? BADGE_TIERS[idx - 1].count : 0;
  const span = tier.count - floor;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (count - floor) / span));
}

// When each milestone was reached. A collection hit its 50th record on the day
// its 50th record was saved, so the dates are derived from `savedAt` rather
// than stored: that gets the badges a long-standing collector earned years ago
// right, instead of stamping them all with the day the feature shipped.
//
// `stored` is the fallback for a tier the collection can no longer account for
// (records deleted since), so a banked badge never shows a blank date.
export function unlockDates(records = [], stored = {}) {
  const times = records
    .map(r => r?.savedAt)
    .filter(t => typeof t === 'number' && Number.isFinite(t))
    .sort((a, b) => a - b);

  const out = {};
  for (const tier of BADGE_TIERS) {
    if (times.length >= tier.count) out[tier.count] = times[tier.count - 1];
    else if (stored[tier.count]) out[tier.count] = stored[tier.count];
  }
  return out;
}

// Decides what to put on screen, and what to write back to the ledger.
//
// Only ONE card is ever shown: the highest tier earned but not yet celebrated.
// That covers the two ways a user arrives with several at once -- a bulk import
// that jumps the count by hundreds, and an existing collector meeting the
// system for the first time -- and in both cases a stack of six cards would
// read as a chore rather than a reward.
//
// Returns { badge, celebrated }. `celebrated` is the ledger to persist, and it
// marks every earned tier, including the ones that were skipped past silently.
export function planCelebration(count, celebrated = []) {
  const known = new Set(celebrated);
  const earned = earnedTiers(count);
  const fresh = earned.filter(t => !known.has(t.count));
  for (const t of earned) known.add(t.count);
  return {
    badge: fresh.length ? fresh[fresh.length - 1] : null,
    celebrated: [...known].sort((a, b) => a - b),
  };
}

// ----- ledger storage --------------------------------------------------------
//
// Scoped to the signed-in user like every other local key (see useCollection):
// badges belong to an account, not to a browser. The ledger is local only, so
// a first sign-in on a new device replays the single highest card once. That
// is a welcome rather than a bug, and it costs no schema change.

const keyFor = (userId) => (userId ? `vinylvault_badges:${userId}` : null);

const EMPTY_LEDGER = { celebrated: [], unlockedAt: {}, suites: {} };

export function loadLedger(userId) {
  const key = keyFor(userId);
  if (!key) return EMPTY_LEDGER;
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (!Array.isArray(raw?.celebrated)) return EMPTY_LEDGER;
    return {
      celebrated: raw.celebrated.filter(n => typeof n === 'number' && Number.isFinite(n)),
      // Absent on ledgers written before dates existed. unlockDates derives
      // those from the collection anyway, so there is nothing to migrate.
      unlockedAt: (raw.unlockedAt && typeof raw.unlockedAt === 'object') ? raw.unlockedAt : {},
      // The decades, range and passport ledgers. Absent on older ledgers,
      // which simply means none of those has been celebrated yet.
      suites: (raw.suites && typeof raw.suites === 'object') ? raw.suites : {},
    };
  } catch {
    return EMPTY_LEDGER;
  }
}

export function saveLedger(userId, ledger) {
  const key = keyFor(userId);
  if (!key) return;
  safeSetItem(localStorage, key, JSON.stringify(ledger));
}

// Timestamps the tiers that have just been banked, leaving existing stamps
// alone so a date is never rewritten.
export function stampUnlocks(unlockedAt, celebrated, now = Date.now()) {
  const out = { ...unlockedAt };
  for (const c of celebrated) if (!out[c]) out[c] = now;
  return out;
}

// ----- the other suites ------------------------------------------------------
//
// The records ladder rewards size. These three reward reach: how far back the
// racks go, how many styles they cover, and how many countries pressed them.
// Each is its own colour so a grid of mixed badges reads by suite at a glance,
// and each has its own ledger, so earning one never banks or blocks another.
//
// Thresholds were set against real collections, not guessed. Every collection
// over about thirty records already spans six to eight decades with a single
// record, which would have unlocked a three-to-six ladder for everybody on day
// one; a decade counts only once it holds DECADE_MIN records, and on that
// reading the same collections spread from two to seven.

export const DECADE_MIN = 10;

export const DECADE_TIERS = [
  { count: 3, name: 'Rewind',        icon: 'ClockCounterClockwise', line: 'Three decades, ten records apiece. The past is filing in.' },
  { count: 5, name: 'Time Slip',     icon: 'Hourglass',             line: 'Five decades held properly. Half a century in the racks.' },
  { count: 7, name: 'Wormhole',      icon: 'Spiral',                line: 'Seven decades deep. The crates fold time now.' },
  { count: 8, name: 'Event Horizon', icon: 'Aperture',              line: 'Eight decades, ten records in every one. Nothing escapes.' },
];

export const RANGE_TIERS = [
  { count: 10,  name: 'Crossfade',   icon: 'Faders',   line: 'Ten styles in the mix. The blend has started.' },
  { count: 25,  name: 'Wide Ears',   icon: 'Ear',      line: 'Twenty-five styles. You listen past the label.' },
  { count: 50,  name: 'Genre Fluid', icon: 'Waves',    line: 'Fifty styles and no fixed address.' },
  { count: 100, name: 'Omnivore',    icon: 'Shuffle',  line: 'One hundred styles. Nothing is off the menu.' },
  { count: 150, name: 'No Borders',  icon: 'Infinity', line: 'One hundred and fifty styles. The map ran out.' },
];

export const PASSPORT_TIERS = [
  { count: 5,  name: 'Carry-On',        icon: 'Suitcase',            line: 'Pressings from five countries.' },
  { count: 10, name: 'Customs Cleared', icon: 'Stamp',               line: 'Ten countries stamped into the sleeves.' },
  { count: 20, name: 'Frequent Flyer',  icon: 'AirplaneTilt',        line: 'Twenty countries of pressing plants.' },
  { count: 40, name: 'Long Haul',       icon: 'GlobeHemisphereWest', line: 'Forty countries. The crates are well travelled.' },
  { count: 60, name: 'Atlas',           icon: 'Globe',               line: 'Sixty countries. The world, one sleeve at a time.' },
];

// Discogs' fifteen top-level genres. The saved `genres` array carries these
// AND the styles under them, merged; Range counts the styles, because fifteen
// is the whole of Discogs and "Brass & Military" is not a badge anybody
// should need.
export const TOP_GENRES = new Set([
  'blues', 'brass & military', "children's", 'classical', 'electronic',
  'folk, world, & country', 'funk / soul', 'hip hop', 'jazz', 'latin',
  'non-music', 'pop', 'reggae', 'rock', 'stage & screen',
]);

function decadeOf(year) {
  const y = typeof year === 'number' ? year : parseInt(String(year || ''), 10);
  if (!Number.isFinite(y) || y < 1900 || y > 2100) return null;
  return Math.floor(y / 10) * 10;
}

// Each measure is a running tally fed one record at a time. The size of the
// collection and the dates the badges were reached both come out of the same
// tally, so the number on the grid and the date under it cannot disagree.
const TALLIES = {
  records: () => { let n = 0; return () => ++n; },
  decades: () => {
    const per = new Map();
    let full = 0;
    return (r) => {
      const d = decadeOf(r?.year);
      if (d != null) {
        const c = (per.get(d) || 0) + 1;
        per.set(d, c);
        if (c === DECADE_MIN) full += 1;
      }
      return full;
    };
  },
  range: () => {
    const seen = new Set();
    return (r) => {
      for (const g of Array.isArray(r?.genres) ? r.genres : []) {
        const k = String(g || '').trim().toLowerCase();
        if (k && !TOP_GENRES.has(k)) seen.add(k);
      }
      return seen.size;
    };
  },
  passport: () => {
    const seen = new Set();
    return (r) => {
      const s = passportStamp(r?.country);
      if (s) seen.add(s);
      return seen.size;
    };
  },
};

// colour is the card and the unlocked tile; ink sits on top of every one of
// them at 7:1 or better (acid 16.8, blue 13.0, pink 7.3, purple 7.1).
export const SUITES = [
  { id: 'records',  title: 'Records',  colour: '#cafe04', unit: ['record', 'records'],   tiers: BADGE_TIERS },
  { id: 'decades',  title: 'Decades',  colour: '#ff5ec4', unit: ['decade', 'decades'],   tiers: DECADE_TIERS,
    note: `A decade counts once it holds ${DECADE_MIN} records.` },
  { id: 'range',    title: 'Range',    colour: '#5ce1ff', unit: ['style', 'styles'],     tiers: RANGE_TIERS,
    note: 'Discogs styles across the collection.' },
  { id: 'passport', title: 'Passport', colour: '#bd7bff', unit: ['country', 'countries'], tiers: PASSPORT_TIERS,
    note: 'Countries your pressings were made in.' },
];

export const suiteById = (id) => SUITES.find(s => s.id === id) || SUITES[0];

export const unitFor = (suite, n) => (n === 1 ? suite.unit[0] : suite.unit[1]);

// Every suite's current value for a collection.
export function measureAll(records = []) {
  const out = {};
  for (const suite of SUITES) {
    const add = TALLIES[suite.id]();
    let v = 0;
    for (const r of records) v = add(r);
    out[suite.id] = v;
  }
  return out;
}

const earnedIn = (suite, value) => suite.tiers.filter(t => value >= t.count);

export function suiteUnlocked(suite, value, celebrated = []) {
  const set = new Set(earnedIn(suite, value).map(t => t.count));
  for (const c of celebrated) set.add(c);
  return set;
}

export function suiteNext(suite, value, celebrated = []) {
  const unlocked = suiteUnlocked(suite, value, celebrated);
  return suite.tiers.find(t => !unlocked.has(t.count)) || null;
}

export function suiteProgress(suite, value, tier) {
  if (!tier) return 1;
  const idx = suite.tiers.indexOf(tier);
  const floor = idx > 0 ? suite.tiers[idx - 1].count : 0;
  const span = tier.count - floor;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (value - floor) / span));
}

// When each tier of each suite was reached, read off `savedAt` in order: the
// day the seventh decade reached ten records is the day Wormhole was earned.
// `stored` is the per-suite ledger fallback for a tier the collection can no
// longer account for.
export function allUnlockDates(records = [], ledger = {}) {
  const ordered = records
    .filter(r => typeof r?.savedAt === 'number' && Number.isFinite(r.savedAt))
    .sort((a, b) => a.savedAt - b.savedAt);
  const out = {};
  for (const suite of SUITES) {
    const add = TALLIES[suite.id]();
    const dates = {};
    let i = 0;
    for (const r of ordered) {
      const v = add(r);
      while (i < suite.tiers.length && v >= suite.tiers[i].count) {
        dates[suite.tiers[i].count] = r.savedAt;
        i += 1;
      }
      if (i >= suite.tiers.length) break;
    }
    const stored = suiteLedger(ledger, suite.id).unlockedAt || {};
    for (const t of suite.tiers) if (!dates[t.count] && stored[t.count]) dates[t.count] = stored[t.count];
    out[suite.id] = dates;
  }
  return out;
}

// The records suite keeps the ledger's original top-level shape, so ledgers
// written before the other suites existed load unchanged. The rest live under
// `suites`.
export function suiteLedger(ledger, id) {
  if (id === 'records') {
    return { celebrated: ledger?.celebrated || [], unlockedAt: ledger?.unlockedAt || {} };
  }
  const s = ledger?.suites?.[id];
  return {
    celebrated: Array.isArray(s?.celebrated) ? s.celebrated.filter(n => typeof n === 'number' && Number.isFinite(n)) : [],
    unlockedAt: (s?.unlockedAt && typeof s.unlockedAt === 'object') ? s.unlockedAt : {},
  };
}

function withSuiteLedger(ledger, id, part) {
  if (id === 'records') return { ...ledger, celebrated: part.celebrated, unlockedAt: part.unlockedAt };
  return { ...ledger, suites: { ...(ledger?.suites || {}), [id]: part } };
}

// One card per suite, never more: the highest tier each suite has earned and
// not yet celebrated, in suite order, so they can be shown one after another.
// Everything earned is banked, including the tiers skipped past silently, the
// same rule planCelebration keeps for the records ladder.
//
// Returns { badges: [{ suite, tier }], ledger, changed }.
export function planAllCelebrations(values, ledger, now = Date.now()) {
  let next = { celebrated: [], unlockedAt: {}, ...(ledger || {}) };
  const badges = [];
  let changed = false;
  for (const suite of SUITES) {
    const part = suiteLedger(next, suite.id);
    const known = new Set(part.celebrated);
    const earned = earnedIn(suite, values?.[suite.id] || 0);
    const fresh = earned.filter(t => !known.has(t.count));
    if (!fresh.length) continue;
    for (const t of earned) known.add(t.count);
    const celebrated = [...known].sort((a, b) => a - b);
    next = withSuiteLedger(next, suite.id, { celebrated, unlockedAt: stampUnlocks(part.unlockedAt, celebrated, now) });
    badges.push({ suite, tier: fresh[fresh.length - 1] });
    changed = true;
  }
  return { badges, ledger: next, changed };
}
