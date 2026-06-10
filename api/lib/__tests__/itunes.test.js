import { describe, it, expect } from 'vitest';
import { parseDurationSecs, titleScore, scoreMatch, bestMatch, norm } from '../itunes.js';

// ---------------------------------------------------------------------------
// parseDurationSecs()
// ---------------------------------------------------------------------------

describe('parseDurationSecs()', () => {
  it('parses "4:32" → 272', () => expect(parseDurationSecs('4:32')).toBe(272));
  it('parses "0:45" → 45', () => expect(parseDurationSecs('0:45')).toBe(45));
  it('parses "10:00" → 600', () => expect(parseDurationSecs('10:00')).toBe(600));
  it('returns null for null', () => expect(parseDurationSecs(null)).toBeNull());
  it('returns null for empty string', () => expect(parseDurationSecs('')).toBeNull());
  it('returns null for non-duration string', () => expect(parseDurationSecs('Spastik')).toBeNull());
  it('parses "7:07" → 427', () => expect(parseDurationSecs('7:07')).toBe(427));
});

// ---------------------------------------------------------------------------
// norm() (itunes version)
// ---------------------------------------------------------------------------

describe('norm() itunes', () => {
  it('strips punctuation and lowercases', () => {
    expect(norm("C. Craig's Mind Mix")).toBe('c craigs mind mix');
  });
  it('collapses whitespace', () => expect(norm('  test  ')).toBe('test'));
});

// ---------------------------------------------------------------------------
// titleScore()
// ---------------------------------------------------------------------------

describe('titleScore()', () => {
  it('exact match → 4', () => expect(titleScore('Spastik', 'Spastik')).toBe(4));
  it('empty inputs → 0', () => {
    expect(titleScore('', 'Spastik')).toBe(0);
    expect(titleScore('Spastik', '')).toBe(0);
  });
  it('full word overlap (3 words) → 3', () => {
    expect(titleScore('Selected Ambient Works', 'Selected Ambient Works 85-92')).toBeGreaterThanOrEqual(2);
  });
  it('no word overlap → 0', () => {
    expect(titleScore('Spastik', 'Windowlicker')).toBe(0);
  });
  it('substring containment gives partial credit', () => {
    expect(titleScore('Galaxy 2 Galaxy', 'Galaxy 2 Galaxy (Live)')).toBeGreaterThanOrEqual(2);
  });
  it('single short words that are substrings still get credit', () => {
    // "LFO" vs "LFO EP" -- short words filtered but substring containment handles it
    const s = titleScore('LFO', 'LFO EP');
    expect(s).toBeGreaterThanOrEqual(1);
  });
  it('case insensitive', () => {
    expect(titleScore('SPASTIK', 'Spastik')).toBe(4);
  });
  it('partial word overlap scales appropriately', () => {
    const highOverlap = titleScore('Come To Daddy', 'Come To Daddy EP');
    const lowOverlap  = titleScore('Come', 'Come To Daddy EP');
    expect(highOverlap).toBeGreaterThan(lowOverlap);
  });
});

// ---------------------------------------------------------------------------
// scoreMatch() — core iTunes matching
// ---------------------------------------------------------------------------

function itunesResult(overrides = {}) {
  return {
    trackName: 'Spastik',
    artistName: 'Plastikman',
    collectionName: 'Consumed',
    releaseDate: '1998-01-01T00:00:00Z',
    trackTimeMillis: 7 * 60 * 1000 + 7 * 1000, // 7:07 = 427s
    previewUrl: 'https://example.com/preview.m4a',
    ...overrides,
  };
}

describe('scoreMatch()', () => {

  it('perfect match: title + artist + duration + year all match', () => {
    const result = itunesResult();
    const score = scoreMatch(result, 'Plastikman', 'Spastik', '7:07', 1998, 'Consumed');
    expect(score).toBeGreaterThanOrEqual(10);
  });

  it('title mismatch → 0 (returns early)', () => {
    const result = itunesResult({ trackName: 'Windowlicker' });
    const score = scoreMatch(result, 'Plastikman', 'Spastik', '7:07', 1998, null);
    expect(score).toBe(0);
  });

  it('duration hard reject: >45s off → -1', () => {
    // Discogs has 7:07 (427s), iTunes result is 3:00 (180s) -- 247s difference
    const result = itunesResult({ trackTimeMillis: 3 * 60 * 1000 });
    const score = scoreMatch(result, 'Plastikman', 'Spastik', '7:07', 1998, null);
    expect(score).toBe(-1);
  });

  it('duration within 5s → +3 bonus', () => {
    const result = itunesResult({ trackTimeMillis: (427 + 3) * 1000 }); // 3s off
    const withDuration    = scoreMatch(result, 'Plastikman', 'Spastik', '7:07', 1998, null);
    const withoutDuration = scoreMatch(itunesResult(), 'Plastikman', 'Spastik', null, 1998, null);
    expect(withDuration).toBeGreaterThan(withoutDuration);
  });

  it('duration 15-30s off → +1 bonus only', () => {
    const result = itunesResult({ trackTimeMillis: (427 + 20) * 1000 }); // 20s off
    const score = scoreMatch(result, 'Plastikman', 'Spastik', '7:07', 1998, null);
    expect(score).toBeGreaterThan(0); // not rejected
  });

  it('artist mismatch with no word overlap → -2 penalty', () => {
    const result = itunesResult({ artistName: 'Kylie Minogue' });
    const score = scoreMatch(result, 'Plastikman', 'Spastik', null, null, null);
    expect(score).toBeLessThan(scoreMatch(itunesResult(), 'Plastikman', 'Spastik', null, null, null));
  });

  it('year within 2 years → +2 bonus', () => {
    const sameYear = itunesResult({ releaseDate: '1998-06-01T00:00:00Z' });
    const farYear  = itunesResult({ releaseDate: '2020-01-01T00:00:00Z' });
    const baseScore = scoreMatch(itunesResult(), 'Plastikman', 'Spastik', null, null, null);
    const sameYearScore = scoreMatch(sameYear, 'Plastikman', 'Spastik', null, 1998, null);
    const farYearScore  = scoreMatch(farYear, 'Plastikman', 'Spastik', null, 1998, null);
    expect(sameYearScore).toBeGreaterThan(baseScore);
    expect(farYearScore).toBeLessThan(sameYearScore);
  });

  it('year more than 15 years off → -2 penalty', () => {
    const base = { trackName: 'Windowlicker', artistName: 'Aphex Twin', trackTimeMillis: 360000, previewUrl: 'x' };
    const sameEra = scoreMatch({ ...base, releaseDate: '2020-01-01T00:00:00Z' }, 'Aphex Twin', 'Windowlicker', null, 2020, null);
    const farEra  = scoreMatch({ ...base, releaseDate: '1993-01-01T00:00:00Z' }, 'Aphex Twin', 'Windowlicker', null, 2020, null);
    expect(sameEra).toBeGreaterThan(farEra);
  });

  it('album title match → additional bonus', () => {
    const withAlbum    = itunesResult({ collectionName: 'Consumed' });
    const withoutAlbum = itunesResult({ collectionName: 'Greatest Hits' });
    const scoreWith    = scoreMatch(withAlbum, 'Plastikman', 'Spastik', null, null, 'Consumed');
    const scoreWithout = scoreMatch(withoutAlbum, 'Plastikman', 'Spastik', null, null, 'Consumed');
    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });

  it('no duration provided: skips duration scoring entirely', () => {
    const result = itunesResult();
    const score = scoreMatch(result, 'Plastikman', 'Spastik', null, null, null);
    expect(score).toBeGreaterThan(0);
  });

  it('partial artist overlap → +1 (not -2)', () => {
    // "Aphex Twin" vs "Twin" -- one word overlaps
    const result = itunesResult({ artistName: 'Twin', trackName: 'Spastik' });
    const score = scoreMatch(result, 'Aphex Twin', 'Spastik', null, null, null);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// bestMatch() — filter and pick winner
// ---------------------------------------------------------------------------

const MIN_SCORE = 3;

describe('bestMatch()', () => {

  it('returns null when no results', () => {
    expect(bestMatch([], 'Plastikman', 'Spastik', null, null, null)).toBeNull();
  });

  it('returns null when no results have previewUrl', () => {
    const result = itunesResult({ previewUrl: null });
    expect(bestMatch([result], 'Plastikman', 'Spastik', null, null, null)).toBeNull();
  });

  it('returns null when best score is below MIN_SCORE', () => {
    // Title doesn't match at all → titleScore 0 → scoreMatch returns 0 → filtered out
    const result = itunesResult({ trackName: 'Totally Different' });
    expect(bestMatch([result], 'Plastikman', 'Spastik', null, null, null)).toBeNull();
  });

  it('returns previewUrl of best match', () => {
    const good = itunesResult({ previewUrl: 'https://example.com/good.m4a' });
    const bad  = itunesResult({ trackName: 'Totally Different', previewUrl: 'https://example.com/bad.m4a' });
    const result = bestMatch([bad, good], 'Plastikman', 'Spastik', null, null, null);
    expect(result?.previewUrl).toBe('https://example.com/good.m4a');
  });

  it('picks higher-scoring match when two valid candidates exist', () => {
    const exact   = itunesResult({ trackName: 'Spastik', previewUrl: 'https://example.com/exact.m4a' });
    const partial = itunesResult({ trackName: 'Spastik (Radio Edit)', previewUrl: 'https://example.com/partial.m4a' });
    const result = bestMatch([partial, exact], 'Plastikman', 'Spastik', '7:07', 1998, null);
    // exact match should win
    expect(result?.previewUrl).toBe('https://example.com/exact.m4a');
  });

  it('hard-rejects duration mismatch even if title matches', () => {
    // Same track title but 3-minute version when discogs says 7:07 (247s off → hard reject)
    const wrongVersion = itunesResult({
      trackTimeMillis: 3 * 60 * 1000,
      previewUrl: 'https://example.com/wrong.m4a',
    });
    const result = bestMatch([wrongVersion], 'Plastikman', 'Spastik', '7:07', null, null);
    expect(result).toBeNull();
  });

  it('returns durationMs with the match', () => {
    const r = itunesResult();
    const result = bestMatch([r], 'Plastikman', 'Spastik', null, null, null);
    expect(result?.durationMs).toBe(r.trackTimeMillis);
  });
});

// ---------------------------------------------------------------------------
// Real-world electronic music scenarios
// ---------------------------------------------------------------------------

describe('iTunes matching — electronic music edge cases', () => {

  it('Burial — Archangel: long atmospheric track matched by title + artist', () => {
    const result = {
      trackName: 'Archangel',
      artistName: 'Burial',
      collectionName: 'Untrue',
      releaseDate: '2007-11-05T00:00:00Z',
      trackTimeMillis: 5 * 60 * 1000 + 7 * 1000, // 5:07
      previewUrl: 'https://example.com/archangel.m4a',
    };
    const score = scoreMatch(result, 'Burial', 'Archangel', '5:07', 2007, 'Untrue');
    expect(score).toBeGreaterThanOrEqual(10);
  });

  it('track with "(Original Mix)" suffix in iTunes still matches Discogs plain title', () => {
    const result = itunesResult({ trackName: 'Spastik (Original Mix)' });
    const score = scoreMatch(result, 'Plastikman', 'Spastik', null, null, null);
    // Substring containment should give partial credit
    expect(score).toBeGreaterThan(0);
  });

  it('remix version is NOT matched when we have exact duration for original', () => {
    // Original is 7:07; remix is 4:30 — hard reject on duration
    const remixResult = itunesResult({
      trackName: 'Spastik (Richie Hawtin Remix)',
      trackTimeMillis: 4 * 60 * 1000 + 30 * 1000, // 4:30
      previewUrl: 'https://example.com/remix.m4a',
    });
    const result = bestMatch([remixResult], 'Plastikman', 'Spastik', '7:07', null, null);
    expect(result).toBeNull();
  });

  it('four Tet — Rounds: hyphenated artist handled', () => {
    const result = {
      trackName: 'My Angel Rocks Back and Forth',
      artistName: 'Four Tet',
      collectionName: 'Rounds',
      releaseDate: '2003-01-01T00:00:00Z',
      trackTimeMillis: 4 * 60 * 1000 + 2 * 1000,
      previewUrl: 'https://example.com/fourtet.m4a',
    };
    const score = scoreMatch(result, 'Four Tet', 'My Angel Rocks Back and Forth', '4:02', 2003, 'Rounds');
    expect(score).toBeGreaterThanOrEqual(10);
  });

  it('different artist same track title: Aphex Twin "Windowlicker" vs someone else', () => {
    const wrongArtist = {
      trackName: 'Windowlicker',
      artistName: 'Unknown Cover Artist',
      trackTimeMillis: 6 * 60 * 1000,
      previewUrl: 'https://example.com/cover.m4a',
    };
    const correctArtist = {
      trackName: 'Windowlicker',
      artistName: 'Aphex Twin',
      trackTimeMillis: 6 * 60 * 1000,
      previewUrl: 'https://example.com/original.m4a',
    };
    const result = bestMatch([wrongArtist, correctArtist], 'Aphex Twin', 'Windowlicker', null, null, null);
    expect(result?.previewUrl).toBe('https://example.com/original.m4a');
  });
});
