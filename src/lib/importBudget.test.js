import { describe, it, expect } from 'vitest';
import {
  gapFor, unmatchedImports, isUnmatchedImport,
  ROW_GAP_MS, LOW_BUDGET_GAP_MS, EXHAUSTED_GAP_MS, LIMIT_BACKOFF_MS,
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
