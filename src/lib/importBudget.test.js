import { describe, it, expect } from 'vitest';
import {
  gapFor, unmatchedImports, isUnmatchedImport, createRateWindow,
  ROW_GAP_MS, LOW_BUDGET_GAP_MS, EXHAUSTED_GAP_MS, LIMIT_BACKOFF_MS,
  IMPORT_RATE_CAP, MS_PER_REQUEST, RATE_WINDOW_MS,
} from './importBudget.js';

describe('gapFor -- pace off the budget Discogs reports', () => {
  it('runs at the steady rate with plenty left', () => {
    expect(gapFor(55)).toBe(ROW_GAP_MS);
    expect(gapFor(16)).toBe(ROW_GAP_MS);
  });

  it('slows down as the window runs down', () => {
    expect(gapFor(15)).toBe(LOW_BUDGET_GAP_MS);
    expect(gapFor(6)).toBe(LOW_BUDGET_GAP_MS);
  });

  it('stands aside when the window is nearly spent', () => {
    expect(gapFor(5)).toBe(EXHAUSTED_GAP_MS);
    expect(gapFor(0)).toBe(EXHAUSTED_GAP_MS);
  });

  it('uses the steady rate when Discogs reports nothing', () => {
    expect(gapFor(null)).toBe(ROW_GAP_MS);
    expect(gapFor(undefined)).toBe(ROW_GAP_MS);
  });

  // The whole point of the number: one lookup per row at this gap has to fit
  // inside 60 requests a minute, or an import trips the limiter and files the
  // rest of the file as unmatched.
  it('keeps a steady run inside the 60-per-minute limit', () => {
    expect(60_000 / ROW_GAP_MS).toBeLessThan(60);
  });

  it('backs off far enough to clear a full limiter window', () => {
    expect(Math.max(...LIMIT_BACKOFF_MS)).toBeGreaterThanOrEqual(60_000);
  });

  // The second version of the bug: pacing per ROW when a row that misses costs
  // TWO requests (targeted search, then the fuzzy fallback). A list full of
  // obscure records then runs at nearly double the budget and trips the
  // limiter anyway, which is exactly what happened on the retry pass.
  it('charges a row for the requests it actually spent', () => {
    expect(gapFor(55, 2)).toBe(2 * MS_PER_REQUEST);
    expect(gapFor(55, 1)).toBe(MS_PER_REQUEST);
  });

  it('keeps a run of misses inside the cap too', () => {
    const perMinute = RATE_WINDOW_MS / gapFor(55, 2) * 2;
    expect(perMinute).toBeLessThanOrEqual(IMPORT_RATE_CAP);
  });

  it('leaves headroom under the 60-a-minute limit for live scanning', () => {
    expect(IMPORT_RATE_CAP).toBeLessThan(60);
  });
});

describe('createRateWindow -- the hard backstop under the pacing', () => {
  it('allows requests up to the cap without waiting', () => {
    const w = createRateWindow(3, 60_000);
    expect(w.waitFor(1, 1000)).toBe(0);
    w.record(3, 1000);
    expect(w.spent(1000)).toBe(3);
  });

  it('holds the next request until the window has room', () => {
    const w = createRateWindow(3, 60_000);
    w.record(3, 1000);
    // The oldest of the three has to age out before a fourth is allowed.
    expect(w.waitFor(1, 1000)).toBe(60_000);
    expect(w.waitFor(1, 31_000)).toBe(30_000);
  });

  it('forgets requests once they leave the window', () => {
    const w = createRateWindow(3, 60_000);
    w.record(3, 1000);
    expect(w.waitFor(1, 62_000)).toBe(0);
    expect(w.spent(62_000)).toBe(0);
  });

  it('waits long enough for a whole lookup, not just one request', () => {
    const w = createRateWindow(4, 60_000);
    w.record(3, 1000);
    // Room for one more request, but a lookup may cost two.
    expect(w.waitFor(1, 1000)).toBe(0);
    expect(w.waitFor(2, 1000)).toBeGreaterThan(0);
  });
});

describe('unmatchedImports', () => {
  const draft   = { id: 'a', discogsId: null, identified: false, source: 'file_import' };
  const matched = { id: 'b', discogsId: '123', identified: true,  source: 'discogs_import' };
  const scan    = { id: 'c', discogsId: null, identified: false, source: 'scan' };

  it('finds the rows an import could not match', () => {
    expect(unmatchedImports([draft, matched, scan]).map(r => r.id)).toEqual(['a']);
  });

  it('leaves an unidentified scan alone -- it has a photo, not a text row', () => {
    expect(isUnmatchedImport(scan)).toBe(false);
  });

  it('never counts a record that did match', () => {
    expect(isUnmatchedImport(matched)).toBe(false);
    expect(isUnmatchedImport({ ...draft, discogsId: '999' })).toBe(false);
  });

  it('survives an empty or missing collection', () => {
    expect(unmatchedImports([])).toEqual([]);
    expect(unmatchedImports(null)).toEqual([]);
    expect(isUnmatchedImport(null)).toBe(false);
  });
});
