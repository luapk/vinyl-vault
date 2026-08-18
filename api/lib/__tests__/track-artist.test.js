import { describe, it, expect } from 'vitest';
import { trackArtist } from '../discogs.js';

describe('trackArtist', () => {
  it('is null on a normal release, where tracks carry no artist of their own', () => {
    expect(trackArtist({ title: 'Song' })).toBeNull();
    expect(trackArtist({ title: 'Song', artists: [] })).toBeNull();
  });

  it('reads the artist off a compilation track', () => {
    expect(trackArtist({ artists: [{ name: 'Aphex Twin' }] })).toBe('Aphex Twin');
  });

  it('strips the Discogs same-name disambiguator', () => {
    // Discogs writes "Nirvana (2)" to separate the band from the 60s group.
    // The number is catalogue bookkeeping, not part of the name a lookup wants.
    expect(trackArtist({ artists: [{ name: 'Nirvana (2)' }] })).toBe('Nirvana');
    expect(trackArtist({ artists: [{ name: 'The Cure  (12)' }] })).toBe('The Cure');
  });

  it('keeps a number that is genuinely part of the name', () => {
    expect(trackArtist({ artists: [{ name: 'Front 242' }] })).toBe('Front 242');
    expect(trackArtist({ artists: [{ name: 'Sunn O)))' }] })).toBe('Sunn O)))');
  });

  it('joins collaborations', () => {
    expect(trackArtist({ artists: [{ name: 'Massive Attack' }, { name: 'Tracey Thorn' }] }))
      .toBe('Massive Attack, Tracey Thorn');
  });

  it('ignores blank and malformed entries rather than emitting stray separators', () => {
    expect(trackArtist({ artists: [{ name: '' }, { name: 'Orbital' }, {}] })).toBe('Orbital');
    expect(trackArtist({ artists: [{ name: '   ' }] })).toBeNull();
  });

  it('survives junk input', () => {
    expect(trackArtist(null)).toBeNull();
    expect(trackArtist(undefined)).toBeNull();
  });
});
