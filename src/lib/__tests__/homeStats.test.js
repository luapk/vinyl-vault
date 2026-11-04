import { describe, it, expect } from 'vitest';
import { homeStats, lastAddedLabel } from '../homeStats.js';

// A fixed local noon, so nothing here depends on when the suite runs.
const NOON = new Date(2026, 2, 12, 12, 0, 0).getTime(); // Thu 12 Mar 2026
const at = (y, m, d, h = 12) => new Date(y, m, d, h).toISOString();

describe('lastAddedLabel', () => {
  it('says nothing when there is no date', () => {
    expect(lastAddedLabel(null, NOON)).toBe(null);
    expect(lastAddedLabel(undefined, NOON)).toBe(null);
    expect(lastAddedLabel('not a date', NOON)).toBe(null);
  });

  it('reads today for any time on the current calendar day', () => {
    expect(lastAddedLabel(at(2026, 2, 12, 0), NOON)).toBe('Today');
    expect(lastAddedLabel(at(2026, 2, 12, 11), NOON)).toBe('Today');
  });

  // The edge that matters: a save four minutes ago, with midnight in between,
  // is yesterday by the calendar and must not round to "Today" on elapsed ms.
  it('uses calendar days, not elapsed hours', () => {
    const justBeforeMidnight = new Date(2026, 2, 11, 23, 58).getTime();
    const justAfterMidnight = new Date(2026, 2, 12, 0, 2).getTime();
    expect(lastAddedLabel(new Date(justBeforeMidnight).toISOString(), justAfterMidnight))
      .toBe('Yesterday');
  });

  it('names the weekday inside the last week', () => {
    // Mon 9 Mar 2026, three days before the fixed Thursday.
    expect(lastAddedLabel(at(2026, 2, 9), NOON)).toBe(
      new Date(2026, 2, 9).toLocaleDateString(undefined, { weekday: 'short' }));
  });

  it('switches to a date once the weekday stops being useful', () => {
    const label = lastAddedLabel(at(2026, 1, 20), NOON);
    expect(label).not.toMatch(/Today|Yesterday/);
    expect(label).toBe(new Date(2026, 1, 20).toLocaleDateString(undefined,
      { day: 'numeric', month: 'short' }));
  });

  it('carries the year once the save is in a different one', () => {
    expect(lastAddedLabel(at(2024, 5, 2), NOON)).toBe(
      new Date(2024, 5, 2).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }));
  });

  // A device with a skewed clock would otherwise print "in 3 days".
  it('refuses a date in the future', () => {
    expect(lastAddedLabel(at(2026, 2, 20), NOON)).toBe(null);
  });
});

describe('homeStats', () => {
  it('says nothing about an empty collection', () => {
    expect(homeStats([], NOON)).toEqual({ count: 0, lastAdded: null });
    expect(homeStats(undefined, NOON)).toEqual({ count: 0, lastAdded: null });
  });

  it('counts every record, including ones with no date', () => {
    const got = homeStats([{ savedAt: at(2026, 2, 12) }, {}, { savedAt: null }], NOON);
    expect(got.count).toBe(3);
    expect(got.lastAdded).toBe('Today');
  });

  // The list is not sorted, so the newest has to be found rather than read
  // off either end.
  it('finds the newest save wherever it sits in the list', () => {
    const got = homeStats([
      { savedAt: at(2025, 0, 1) },
      { savedAt: at(2026, 2, 12) },
      { savedAt: at(2024, 4, 4) },
    ], NOON);
    expect(got.lastAdded).toBe('Today');
  });

  it('reports a count with no date when nothing carries one', () => {
    expect(homeStats([{}, {}], NOON)).toEqual({ count: 2, lastAdded: null });
  });
});
