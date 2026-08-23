// Pacing rules for the file import, and the definition of a row it could not
// match. Pure, so the numbers that decide whether an import stays inside the
// Discogs rate limit can be tested without a browser.

// Discogs allows 60 authenticated requests a minute. We spend at most this
// many on an import, leaving the rest for everyone else's live scanning.
export const IMPORT_RATE_CAP = 45;
export const RATE_WINDOW_MS = 60_000;

// What one Discogs request costs in waiting time if the whole window is spent
// evenly. Pacing by ROW rather than by REQUEST was the flaw in the first fix:
// a row that matches costs one request, but a row that misses costs two (the
// targeted search, then the fuzzy fallback), so a list full of obscure records
// ran at nearly double the budget and tripped the limiter anyway.
export const MS_PER_REQUEST = Math.ceil(RATE_WINDOW_MS / IMPORT_RATE_CAP);

// Floor for a single row, so a run never bursts even if a lookup reports
// nothing about what it spent.
export const ROW_GAP_MS = MS_PER_REQUEST;
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

// How long to wait after a row, given what Discogs says is left in the window
// and how many requests the row actually spent. remaining is null when Discogs
// said nothing, in which case the even rate is the safe guess.
export function gapFor(remaining, requests = 1) {
  const spent = Math.max(1, requests) * MS_PER_REQUEST;
  if (remaining == null) return spent;
  if (remaining <= NEARLY_SPENT) return EXHAUSTED_GAP_MS;
  if (remaining <= LOW_BUDGET) return Math.max(spent, LOW_BUDGET_GAP_MS);
  return spent;
}

// A sliding-window count of requests actually spent, as a hard backstop under
// the even pacing above. Pacing alone assumes every request is accounted for;
// this notices when they are not (a retry inside the proxy, a second tab
// importing) and holds the next lookup until the window has room for it.
export function createRateWindow(cap = IMPORT_RATE_CAP, windowMs = RATE_WINDOW_MS) {
  let stamps = [];
  const prune = (now) => { stamps = stamps.filter(t => now - t < windowMs); };
  return {
    record(n = 1, now = Date.now()) {
      for (let i = 0; i < Math.max(1, n); i++) stamps.push(now);
      prune(now);
    },
    // Milliseconds to wait before spending n more requests without exceeding
    // the cap. Zero whenever there is room right now.
    waitFor(n = 1, now = Date.now()) {
      prune(now);
      const over = stamps.length + Math.max(1, n) - cap;
      if (over <= 0) return 0;
      const oldest = stamps[over - 1];
      return Math.max(0, windowMs - (now - oldest));
    },
    spent(now = Date.now()) { prune(now); return stamps.length; },
  };
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
