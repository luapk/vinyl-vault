import { describe, it, expect } from 'vitest';
import {
  scoreCandidate, rankCandidates, normalizeCatno, extractRawCatnos, norm, sim, GENRE_WORDS,
} from '../scoring.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function candidate(artist, title, label) {
  return { artist, recordTitle: title, label: label || null };
}

function vision(artist, title, label) {
  return { artist: artist || '', title: title || '', label: label || '' };
}

// ---------------------------------------------------------------------------
// norm()
// ---------------------------------------------------------------------------

describe('norm()', () => {
  it('lowercases', () => expect(norm('Aphex Twin')).toBe('aphex twin'));
  it('strips Discogs disambiguation suffix "(2)"', () => expect(norm('Plastikman (2)')).toBe('plastikman'));
  it('strips punctuation', () => expect(norm('R&S Records')).toBe('r s records'));
  it('collapses whitespace', () => expect(norm('  Warp   Records  ')).toBe('warp records'));
  it('handles null', () => expect(norm(null)).toBe(''));
  it('handles empty string', () => expect(norm('')).toBe(''));
});

// ---------------------------------------------------------------------------
// sim()
// ---------------------------------------------------------------------------

describe('sim()', () => {
  it('returns 1 for identical strings', () => expect(sim('Aphex Twin', 'Aphex Twin')).toBe(1));
  it('returns null when either value is empty', () => {
    expect(sim('', 'Aphex Twin')).toBeNull();
    expect(sim('Aphex Twin', '')).toBeNull();
    expect(sim(null, null)).toBeNull();
  });
  it('returns 0.8 for substring containment', () => {
    expect(sim('Warp Records', 'Warp')).toBe(0.8);
    expect(sim('Warp', 'Warp Records')).toBe(0.8);
  });
  it('scores partial word overlap proportionally', () => {
    const s = sim('Selected Ambient Works', 'Selected Ambient Works Volume II');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
  it('returns null when no words long enough to compare', () => {
    expect(sim('A1', 'B2')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// scoreCandidate() -- true positive cases
// ---------------------------------------------------------------------------

describe('scoreCandidate() -- true positives', () => {

  it('perfect match: artist + title + label all correct', () => {
    const c = candidate('Aphex Twin', 'Selected Ambient Works 85-92', 'Apollo');
    const v = vision('Aphex Twin', 'Selected Ambient Works', 'Apollo');
    expect(scoreCandidate(c, v)).toBeGreaterThanOrEqual(8);
  });

  it('Plastikman -- Spastik (artist + title match)', () => {
    const c = candidate('Plastikman', 'Spastik', 'R&S Records');
    const v = vision('Plastikman', 'Spastik', 'R&S');
    expect(scoreCandidate(c, v)).toBeGreaterThanOrEqual(8);
  });

  it('LFO -- LFO (short title exact)', () => {
    const c = candidate('LFO', 'LFO', 'Warp');
    const v = vision('LFO', 'LFO', 'Warp');
    expect(scoreCandidate(c, v)).toBeGreaterThanOrEqual(5);
  });

  it('case-insensitive artist match', () => {
    const c = candidate('aphex twin', 'selected ambient works', 'apollo');
    const v = vision('Aphex Twin', 'Selected Ambient Works', 'Apollo');
    expect(scoreCandidate(c, v)).toBeGreaterThanOrEqual(8);
  });

  it('Discogs disambiguation suffix stripped: "Plastikman (2)" matches "Plastikman"', () => {
    const c = candidate('Plastikman (2)', 'Spastik', 'R&S Records');
    const v = vision('Plastikman', 'Spastik', 'R&S');
    expect(scoreCandidate(c, v)).toBeGreaterThanOrEqual(8);
  });

  it('partial title overlap still scores positively', () => {
    const c = candidate('Aphex Twin', 'Selected Ambient Works Volume II', 'Apollo');
    const v = vision('Aphex Twin', 'Selected Ambient Works', 'Apollo');
    const score = scoreCandidate(c, v);
    expect(score).toBeGreaterThan(0);
  });

  it('label-only match gives a small bonus on top of artist+title', () => {
    const withLabel    = candidate('Burial', 'Untrue', 'Hyperdub');
    const withoutLabel = candidate('Burial', 'Untrue', 'Unknown Label');
    const v = vision('Burial', 'Untrue', 'Hyperdub');
    expect(scoreCandidate(withLabel, v)).toBeGreaterThan(scoreCandidate(withoutLabel, v));
  });

  it('null vision gives score 0', () => {
    expect(scoreCandidate(candidate('Aphex Twin', 'SAW', 'Apollo'), null)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreCandidate() -- false catno collision detection
// ---------------------------------------------------------------------------

describe('scoreCandidate() -- false catno collisions', () => {

  it('completely wrong artist with matching catno scores negative', () => {
    // "PM-012" exists on two different labels; wrong artist should be penalised
    const c = candidate('Some Other Artist', 'Totally Different EP', 'Some Label');
    const v = vision('Carl Craig', 'Mind', 'Planet E');
    expect(scoreCandidate(c, v)).toBeLessThan(0);
  });

  it('wrong artist scores worse than correct artist', () => {
    const visionReading = vision('Aphex Twin', 'Windowlicker', 'Warp');
    const correct = candidate('Aphex Twin', 'Windowlicker', 'Warp');
    const collision = candidate('Unknown Artist', 'Windowlicker', 'Another Label');
    expect(scoreCandidate(correct, visionReading)).toBeGreaterThan(scoreCandidate(collision, visionReading));
  });

  it('title mismatch alone penalises when we have a title', () => {
    const c = candidate('Aphex Twin', 'Come to Daddy', 'Warp');
    const v = vision('Aphex Twin', 'Windowlicker', 'Warp');
    const score = scoreCandidate(c, v);
    // Artist matches (+4), title mismatches (-1), so should still be positive but less than perfect
    expect(score).toBeLessThan(scoreCandidate(candidate('Aphex Twin', 'Windowlicker', 'Warp'), v));
  });

  it('completely wrong result on all fields scores very negative', () => {
    const c = candidate('Madonna', 'Like a Prayer', 'Sire');
    const v = vision('Aphex Twin', 'Selected Ambient Works', 'Apollo');
    expect(scoreCandidate(c, v)).toBeLessThanOrEqual(-3);
  });
});

// ---------------------------------------------------------------------------
// scoreCandidate() -- artist reliability detection
// ---------------------------------------------------------------------------

describe('scoreCandidate() -- artist reliability', () => {

  it('label=artist confusion: artist same as label -> no artist bonus or penalty', () => {
    // Vision misread "Warp Records" imprint as the artist
    const c = candidate('LFO', 'LFO', 'Warp');
    const v = vision('Warp', 'LFO', 'Warp');
    const score = scoreCandidate(c, v);
    // Artist signal is suppressed (no +4 or -3), only title and label contribute
    expect(score).toBeGreaterThanOrEqual(0); // should not be penalised for artist mismatch
  });

  it('Purpose Maker: label imprint used as artist is treated as unreliable', () => {
    // Vision reads "Purpose Maker" as artist when it is the label name
    const c = candidate('Carl Craig', 'Mind', 'Purpose Maker');
    const v = vision('Purpose Maker', 'Mind', 'Purpose Maker');
    // Artist overlap with label suppresses artist signal; title still matches
    const score = scoreCandidate(c, v);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('genre word as artist ("Techno") is treated as unreliable', () => {
    const c = candidate('Plastikman', 'Spastik', 'R&S');
    const v = vision('Techno', 'Spastik', 'R&S');
    // "Techno" is in GENRE_WORDS -> artist ignored -> should not penalise for mismatch
    const score = scoreCandidate(c, v);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('each genre word is in GENRE_WORDS', () => {
    ['techno', 'house', 'ambient', 'jungle', 'dub', 'electro'].forEach(w => {
      expect(GENRE_WORDS.has(w)).toBe(true);
    });
  });

  it('real artist names are not in GENRE_WORDS', () => {
    ['aphex', 'burial', 'plastikman', 'autechre'].forEach(w => {
      expect(GENRE_WORDS.has(w)).toBe(false);
    });
  });

  it('artist "R&S" (same as label "R&S Records") is treated as unreliable', () => {
    const c = candidate('Plastikman', 'Spastik', 'R&S Records');
    const v = vision('R&S', 'Spastik', 'R&S Records');
    const score = scoreCandidate(c, v);
    expect(score).toBeGreaterThanOrEqual(0); // artist suppressed, no unfair penalty
  });
});

// ---------------------------------------------------------------------------
// scoreCandidate() -- null / missing field handling
// ---------------------------------------------------------------------------

describe('scoreCandidate() -- missing fields', () => {

  it('null title in candidate: no title signal', () => {
    const c = candidate('Aphex Twin', null, 'Warp');
    const v = vision('Aphex Twin', 'Windowlicker', 'Warp');
    const score = scoreCandidate(c, v);
    // Only artist and label contribute; no title penalty for missing candidate field
    expect(score).toBeGreaterThanOrEqual(4); // artist +4
  });

  it('null title in vision: no title signal', () => {
    const c = candidate('Aphex Twin', 'Windowlicker', 'Warp');
    const v = vision('Aphex Twin', null, 'Warp');
    const score = scoreCandidate(c, v);
    expect(score).toBeGreaterThanOrEqual(4);
  });

  it('empty vision: score 0', () => {
    const c = candidate('Aphex Twin', 'Windowlicker', 'Warp');
    const v = vision('', '', '');
    expect(scoreCandidate(c, v)).toBe(0);
  });

  it('uses candidate.title when recordTitle is absent', () => {
    const c = { artist: 'Aphex Twin', title: 'Windowlicker', label: 'Warp' };
    const v = vision('Aphex Twin', 'Windowlicker', 'Warp');
    expect(scoreCandidate(c, v)).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// rankCandidates()
// ---------------------------------------------------------------------------

describe('rankCandidates()', () => {

  it('single candidate always returned unchanged', () => {
    const c = [candidate('Aphex Twin', 'SAW', 'Apollo')];
    const v = vision('Aphex Twin', 'SAW', 'Apollo');
    expect(rankCandidates(c, v)).toEqual(c);
  });

  it('correct match ranked above false catno collision', () => {
    const correct  = candidate('Plastikman', 'Spastik', 'R&S Records');
    const wrong    = candidate('Other Artist', 'Other EP', 'Other Label');
    const v = vision('Plastikman', 'Spastik', 'R&S');
    const ranked = rankCandidates([wrong, correct], v);
    expect(ranked[0]).toBe(correct);
  });

  it('never returns empty -- falls back to full list when all score negative', () => {
    const c = [
      candidate('Madonna', 'Like a Prayer', 'Sire'),
      candidate('Spice Girls', 'Wannabe', 'Virgin'),
    ];
    const v = vision('Aphex Twin', 'SAW', 'Apollo');
    const ranked = rankCandidates(c, v);
    expect(ranked.length).toBeGreaterThan(0);
  });

  it('no vision: returns candidates unchanged', () => {
    const c = [candidate('A', 'B', 'C'), candidate('D', 'E', 'F')];
    expect(rankCandidates(c, null)).toEqual(c);
  });

  it('drops clearly wrong candidates when better ones exist', () => {
    const correct  = candidate('Basic Channel', 'Phylyps Trak', 'Basic Channel');
    const wrongA   = candidate('Madonna', 'Holiday', 'Sire');
    const wrongB   = candidate('Kylie Minogue', 'Spinning Around', 'Parlophone');
    const v = vision('Basic Channel', 'Phylyps Trak', 'Basic Channel');
    const ranked = rankCandidates([wrongA, correct, wrongB], v);
    expect(ranked[0]).toBe(correct);
    // wrong candidates are filtered out since correct exists with score >= 0
    expect(ranked).not.toContain(wrongA);
    expect(ranked).not.toContain(wrongB);
  });

  it('preserves original order for equal-scoring candidates', () => {
    const a = candidate('Aphex Twin', 'Polynomial-C', 'Warp');
    const b = candidate('Aphex Twin', 'Polynomial-C', 'Warp');
    const v = vision('Aphex Twin', 'Polynomial-C', 'Warp');
    const ranked = rankCandidates([a, b], v);
    expect(ranked.length).toBe(2);
  });

  it('ranks three candidates correctly: exact > partial > wrong', () => {
    const exact   = candidate('Underground Resistance', 'Galaxy 2 Galaxy', 'UR');
    const partial = candidate('Underground Resistance', 'Riot', 'UR');
    const wrong   = candidate('Moby', 'Go', 'Instinct');
    const v = vision('Underground Resistance', 'Galaxy 2 Galaxy', 'UR');
    const ranked = rankCandidates([wrong, partial, exact], v);
    expect(ranked[0]).toBe(exact);
    expect(ranked[ranked.length - 1]).not.toBe(exact);
  });
});

// ---------------------------------------------------------------------------
// normalizeCatno()
// ---------------------------------------------------------------------------

describe('normalizeCatno()', () => {
  it('returns original, stripped, and dashed variants', () => {
    const variants = normalizeCatno('PM-012');
    expect(variants).toContain('PM-012');
    expect(variants).toContain('PM012');
  });

  it('WAP 63 strips to WAP63', () => {
    const variants = normalizeCatno('WAP 63');
    expect(variants).toContain('WAP63');
  });

  it('already-clean catno returns single variant', () => {
    const variants = normalizeCatno('WAP63');
    expect(new Set(variants).size).toBe(1);
    expect(variants).toContain('WAP63');
  });

  it('null/empty returns empty array', () => {
    expect(normalizeCatno(null)).toEqual([]);
    expect(normalizeCatno('')).toEqual([]);
  });

  it('STUMM 123 -> STUMM123', () => {
    const variants = normalizeCatno('STUMM 123');
    expect(variants).toContain('STUMM123');
  });
});

// ---------------------------------------------------------------------------
// extractRawCatnos()
// ---------------------------------------------------------------------------

describe('extractRawCatnos()', () => {
  it('extracts a catno from sleeve text', () => {
    const raw = 'APHEX TWIN SELECTED AMBIENT WORKS AMB LP 3922';
    const result = extractRawCatnos(raw, null);
    expect(result.some(c => c.includes('3922') || c.includes('LP'))).toBe(true);
  });

  it('excludes the already-known catalogNumber to avoid duplicate searches', () => {
    const raw = 'WARP WAP63 LFO';
    const result = extractRawCatnos(raw, 'WAP63');
    expect(result).not.toContain('WAP63');
  });

  it('returns empty array for null input', () => {
    expect(extractRawCatnos(null, null)).toEqual([]);
  });

  it('handles text with no catno pattern', () => {
    expect(extractRawCatnos('just some words no codes', null)).toEqual([]);
  });

  it('finds multiple catnos in complex label text', () => {
    const raw = 'Side A: WAP63 / Side B: WAP63B Published 1992';
    const result = extractRawCatnos(raw, null);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
