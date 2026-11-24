import { describe, it, expect } from 'vitest';
import {
  SUITES, DECADE_MIN, measureAll, allUnlockDates, planAllCelebrations, suiteLedger,
  suiteNext, suiteProgress, loadLedger,
} from '../badges.js';
import { passportStamp } from '../countryFlag.js';

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);
// n records from one decade, saved a day apart from `from`.
const decade = (year, n, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `${year}-${i}`, year, savedAt: START + (from + i) * DAY }));

describe('decades', () => {
  it('counts a decade only once it holds DECADE_MIN records', () => {
    expect(DECADE_MIN).toBe(10);
    const recs = [...decade(1975, 10), ...decade(1985, 9), ...decade(1995, 1)];
    expect(measureAll(recs).decades).toBe(1);
    expect(measureAll([...recs, ...decade(1988, 1, 50)]).decades).toBe(2);
  });

  it('reads string years and ignores nonsense', () => {
    const recs = Array.from({ length: 10 }, (_, i) => ({ year: String(1970 + i) }));
    expect(measureAll(recs).decades).toBe(1);
    expect(measureAll([{ year: null }, { year: 'unknown' }, { year: 0 }, { year: 3000 }]).decades).toBe(0);
  });

  it('dates a tier to the record that filled the decade that reached it', () => {
    const recs = [...decade(1965, 10, 0), ...decade(1975, 10, 10), ...decade(1985, 10, 20)];
    const dates = allUnlockDates(recs).decades;
    // the 30th record, saved on day 29, is the tenth of the third decade
    expect(dates[3]).toBe(START + 29 * DAY);
    expect(dates[5]).toBeUndefined();
  });
});

describe('range', () => {
  it('counts styles, not the fifteen top-level genres, case-insensitively', () => {
    const recs = [
      { genres: ['Electronic', 'Deep House', 'Techno'] },
      { genres: ['electronic', 'deep house', 'Acid'] },
      { genres: ['Funk / Soul', 'Pop', 'Rock'] },
      { genres: null },
    ];
    expect(measureAll(recs).range).toBe(3);
  });
});

describe('passport', () => {
  it('is one stamp per country, in the flag vocabulary', () => {
    expect(passportStamp('UK')).toBe('GB');
    expect(passportStamp('United Kingdom')).toBe('GB');
    expect(passportStamp('England')).toBe('GB');
  });

  it('never stamps a region', () => {
    for (const r of ['Europe', 'EU', 'Worldwide', 'Unknown', 'Scandinavia', 'Australasia', '', null]) {
      expect(passportStamp(r)).toBeNull();
    }
  });

  it('stamps only the first real country of a combined territory', () => {
    expect(passportStamp('UK, Europe & US')).toBe('GB');
    expect(passportStamp('Europe & US')).toBe('US');
    expect(passportStamp('France & Benelux')).toBe('FR');
    // and the whole string first, so a country with an ampersand is one country
    expect(passportStamp('Trinidad & Tobago')).toBe('TT');
  });

  it('stamps a state with no flag, and one state under two names once', () => {
    expect(passportStamp('Yugoslavia')).toBe('yugoslavia');
    expect(passportStamp('USSR')).toBe(passportStamp('Soviet Union'));
    expect(passportStamp('East Germany')).toBe(passportStamp('German Democratic Republic (GDR)'));
    expect(passportStamp('Zimbabwe')).toBe('zimbabwe');
  });

  it('counts distinct stamps across the collection', () => {
    const recs = ['UK', 'England', 'Europe', 'US', 'UK, Europe & US', 'Japan', 'Yugoslavia'].map(country => ({ country }));
    expect(measureAll(recs).passport).toBe(4);
  });
});

describe('celebrations across suites', () => {
  const values = { records: 120, decades: 5, range: 30, passport: 2 };

  it('queues the highest fresh tier of each suite, one card per suite, in suite order', () => {
    const { badges } = planAllCelebrations(values, { celebrated: [], unlockedAt: {} }, 1);
    expect(badges.map(b => [b.suite.id, b.tier.name])).toEqual([
      ['records', 'Escape Velocity'],
      ['decades', 'Time Slip'],
      ['range', 'Wide Ears'],
    ]);
  });

  it('banks everything earned so nothing replays, and keeps the old ledger shape for records', () => {
    const { ledger } = planAllCelebrations(values, { celebrated: [], unlockedAt: {} }, 7);
    expect(ledger.celebrated).toEqual([50, 100]);
    expect(ledger.unlockedAt).toEqual({ 50: 7, 100: 7 });
    expect(suiteLedger(ledger, 'decades').celebrated).toEqual([3, 5]);
    const again = planAllCelebrations(values, ledger, 8);
    expect(again.badges).toEqual([]);
    expect(again.changed).toBe(false);
  });

  it('reads a ledger written before the other suites existed', () => {
    const legacy = { celebrated: [50, 100], unlockedAt: { 50: 1, 100: 2 } };
    const { badges } = planAllCelebrations(values, legacy, 9);
    expect(badges.map(b => b.suite.id)).toEqual(['decades', 'range']);
    expect(suiteLedger(legacy, 'records').celebrated).toEqual([50, 100]);
  });

  it('a banked tier stays unlocked after the value falls', () => {
    const decades = SUITES.find(s => s.id === 'decades');
    expect(suiteNext(decades, 2, [3, 5]).name).toBe('Wormhole');
    expect(suiteProgress(decades, 6, suiteNext(decades, 6, [3, 5]))).toBe(0.5);
  });

  it('loadLedger keeps the suites when it reads one back', () => {
    const store = new Map();
    globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    store.set('vinylvault_badges:u1', JSON.stringify({ celebrated: [50], unlockedAt: {}, suites: { range: { celebrated: [10] } } }));
    expect(suiteLedger(loadLedger('u1'), 'range').celebrated).toEqual([10]);
    delete globalThis.localStorage;
  });
});

describe('suites', () => {
  it('every ladder ascends and every colour is distinct', () => {
    for (const s of SUITES) {
      const counts = s.tiers.map(t => t.count);
      expect([...counts].sort((a, b) => a - b)).toEqual(counts);
    }
    expect(new Set(SUITES.map(s => s.colour)).size).toBe(SUITES.length);
  });
});
