import { describe, it, expect } from 'vitest';
import { decadeOf, decadeCounts, matchesFocus, focusLabel, DECADES } from '../collectionFocus.js';

describe('decadeOf', () => {
  it('buckets on the boundary years', () => {
    expect(decadeOf(1969)).toBe('60s');
    expect(decadeOf(1970)).toBe('70s');
    expect(decadeOf(1979)).toBe('70s');
    expect(decadeOf(1980)).toBe('80s');
    expect(decadeOf(1999)).toBe('90s');
    expect(decadeOf(2000)).toBe('00s');
    expect(decadeOf(2019)).toBe('10s');
    expect(decadeOf(2020)).toBe('20s');
  });

  it('folds everything before 1970 into the 60s, as the chart always has', () => {
    expect(decadeOf(1955)).toBe('60s');
    expect(decadeOf(1901)).toBe('60s');
  });

  it('has no decade for a missing or unusable year', () => {
    expect(decadeOf(null)).toBeNull();
    expect(decadeOf(undefined)).toBeNull();
    expect(decadeOf('')).toBeNull();
    expect(decadeOf('unknown')).toBeNull();
    expect(decadeOf(0)).toBeNull();
  });

  it('reads a year that arrived as a string', () => {
    expect(decadeOf('1994')).toBe('90s');
  });
});

describe('decadeCounts', () => {
  it('keeps every bucket, so an empty decade still holds its place', () => {
    const counts = decadeCounts([{ year: 1994 }]);
    expect(Object.keys(counts)).toEqual(DECADES);
    expect(counts['90s']).toBe(1);
    expect(counts['80s']).toBe(0);
  });

  it('ignores records with no usable year', () => {
    const counts = decadeCounts([{ year: 1994 }, { year: null }, {}, { year: 'n/a' }]);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('survives an empty collection', () => {
    expect(Object.values(decadeCounts([])).every(v => v === 0)).toBe(true);
    expect(Object.values(decadeCounts()).every(v => v === 0)).toBe(true);
  });
});

// The bar and the filtered view must agree. If these two ever disagree, a
// chart says 42 and opens onto 39.
describe('the chart and the filter agree', () => {
  const collection = [
    { year: 1968, genres: ['Jazz'] },
    { year: 1972, genres: ['Rock', 'Prog'] },
    { year: 1994, genres: ['House'] },
    { year: 1998, genres: ['House', 'Techno'] },
    { year: null, genres: ['House'] },
  ];

  it('counts the same records the decade filter admits', () => {
    const counts = decadeCounts(collection);
    for (const d of DECADES) {
      const filtered = collection.filter(r => matchesFocus(r, { kind: 'decade', value: d }));
      expect(filtered.length).toBe(counts[d]);
    }
  });

  it('a record with no year is in no decade at all', () => {
    const anyDecade = DECADES.some(d => matchesFocus({ year: null }, { kind: 'decade', value: d }));
    expect(anyDecade).toBe(false);
  });
});

describe('matchesFocus', () => {
  it('matches a genre the record carries, and only that genre', () => {
    const r = { genres: ['House', 'Techno'] };
    expect(matchesFocus(r, { kind: 'genre', value: 'House' })).toBe(true);
    expect(matchesFocus(r, { kind: 'genre', value: 'Jazz' })).toBe(false);
  });

  it('lets everything through when nothing is focused', () => {
    expect(matchesFocus({ genres: [] }, null)).toBe(true);
  });

  it('survives a record with no genres and an unknown focus kind', () => {
    expect(matchesFocus({}, { kind: 'genre', value: 'House' })).toBe(false);
    expect(matchesFocus({}, { kind: 'nonsense', value: 'x' })).toBe(true);
  });
});

describe('focusLabel', () => {
  it('reads as a sentence on the pill', () => {
    expect(focusLabel({ kind: 'decade', value: '90s' })).toBe('90s releases');
    expect(focusLabel({ kind: 'genre', value: 'House' })).toBe('House');
    expect(focusLabel(null)).toBe('');
  });
});
