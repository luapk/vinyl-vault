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

const EMPTY_LEDGER = { celebrated: [], unlockedAt: {} };

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
