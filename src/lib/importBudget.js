// Pacing rules for the file import, and the definition of a row it could not
// match. Pure, so the numbers that decide whether an import stays inside the
// Discogs rate limit can be tested without a browser.

// Discogs allows 60 authenticated requests a minute, and a lookup is normally
// one request, so ~1.1s between rows keeps a whole import inside the budget
// with headroom for the fallback query on rows that do not match first time.
// The old 650ms gap was set without reference to the limit, and each lookup
// then cost two requests: about three times the budget, which is why an import
// matched its first thirty rows and drafted everything after them.
export const ROW_GAP_MS = 1100;
// Widen the gap as the budget runs down, and step aside entirely when it is
// nearly gone. The limiter's window is 60 seconds, so waiting it out costs
// less than a run of rows that come back empty.
export const LOW_BUDGET_GAP_MS = 2500;
export const EXHAUSTED_GAP_MS  = 15000;
export const LOW_BUDGET   = 15;
export const NEARLY_SPENT = 5;

// Waits after a row is actually rate limited. The last one clears a full
// window; if the limiter is still on after that, something bigger is wrong and
// the run stops rather than drafting the rest of the file.
export const LIMIT_BACKOFF_MS = [20000, 40000, 60000];

// remaining is what Discogs itself reports is left in the current window;
// null when it said nothing, in which case the steady rate is the safe guess.
export function gapFor(remaining) {
  if (remaining == null) return ROW_GAP_MS;
  if (remaining <= NEARLY_SPENT) return EXHAUSTED_GAP_MS;
  if (remaining <= LOW_BUDGET) return LOW_BUDGET_GAP_MS;
  return ROW_GAP_MS;
}

// A row the import could not match, saved so nothing is lost. It carries no
// Discogs id, which is also why importing the same file again cannot repair
// it: de-duplication keys on that id, so a second upload adds a second copy.
export function isUnmatchedImport(r) {
  return !!r && !r.discogsId && r.identified === false && r.source === 'file_import';
}

export function unmatchedImports(collection) {
  return (collection || []).filter(isUnmatchedImport);
}
