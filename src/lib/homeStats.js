// The live state the home screen's scan card carries along its bottom rule.
//
// The card is the biggest object on the home screen and for a long time it
// held an icon and six words, so it was spending about 180px of a 740px phone
// to say "Scan a record". It keeps that size now by carrying something only
// this user's collection can say: how big it is, and when it last grew.
//
// Pure and unit-tested because the formatting has edges that are quiet when
// wrong: a record saved four minutes ago must not read as yesterday because
// the clock crossed midnight, and an empty collection must say nothing at all
// rather than "0 in the crate, last added never".

const DAY = 24 * 60 * 60 * 1000;

/** Local midnight for a timestamp, so "yesterday" means the calendar day. */
function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * How the most recent save reads on the card.
 * Null for no usable date: the rule is hidden rather than filled with a dash.
 */
export function lastAddedLabel(savedAt, now = Date.now()) {
  if (!savedAt) return null;
  const then = new Date(savedAt).getTime();
  if (!Number.isFinite(then)) return null;

  // A clock skew or a bad date must not produce "in 3 days".
  if (then > now + DAY) return null;

  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  // Inside the last week the weekday is more use than a date: it is how
  // people actually remember a recent session at the shelves.
  if (days < 7) return new Date(then).toLocaleDateString(undefined, { weekday: 'short' });

  const sameYear = new Date(then).getFullYear() === new Date(now).getFullYear();
  return new Date(then).toLocaleDateString(undefined,
    sameYear ? { day: 'numeric', month: 'short' } : { month: 'short', year: 'numeric' });
}

/**
 * { count, lastAdded } for the scan card's rule.
 *
 * `lastAdded` is null when there is nothing to say, and the caller hides the
 * whole rule when `count` is 0: a collection of none has no state worth a
 * line, and the first-run paragraph above already explains the app.
 */
export function homeStats(collection = [], now = Date.now()) {
  const count = collection.length;
  let newest = null;
  for (const record of collection) {
    const ts = new Date(record?.savedAt ?? NaN).getTime();
    if (Number.isFinite(ts) && (newest === null || ts > newest)) newest = ts;
  }
  return { count, lastAdded: lastAddedLabel(newest, now) };
}
