import { describe, it, expect } from 'vitest';
import { flagFor, countryLabel } from './countryFlag.js';

describe('flagFor', () => {
  it('handles the countries a record collection is actually full of', () => {
    expect(flagFor('UK')).toBe('🇬🇧');
    expect(flagFor('US')).toBe('🇺🇸');
    expect(flagFor('Germany')).toBe('🇩🇪');
    expect(flagFor('Japan')).toBe('🇯🇵');
    expect(flagFor('Netherlands')).toBe('🇳🇱');
  });

  it('uses Discogs spellings, not ISO country names', () => {
    // Discogs says "UK", never "United Kingdom", but accept both.
    expect(flagFor('UK')).toBe(flagFor('United Kingdom'));
    expect(flagFor('US')).toBe(flagFor('USA'));
  });

  it('is case and whitespace insensitive', () => {
    expect(flagFor('  germany ')).toBe('🇩🇪');
  });

  it('treats Discogs regions as regions', () => {
    expect(flagFor('Europe')).toBe('🇪🇺');
    expect(flagFor('EU')).toBe('🇪🇺');
  });

  // A third of this collection's non-UK records are multi-territory presses.
  it('shows every territory of a combined release', () => {
    expect(flagFor('UK & Europe')).toBe('🇬🇧🇪🇺');
    expect(flagFor('UK, Europe & US')).toBe('🇬🇧🇪🇺🇺🇸');
    expect(flagFor('USA & Canada')).toBe('🇺🇸🇨🇦');
    expect(flagFor('UK & Ireland')).toBe('🇬🇧🇮🇪');
    expect(flagFor('USA, Canada & UK')).toBe('🇺🇸🇨🇦🇬🇧');
  });

  // The whole string is tried first, or this would split into two countries.
  it('does not mistake Trinidad & Tobago for a combined release', () => {
    expect(flagFor('Trinidad & Tobago')).toBe('🇹🇹');
  });

  // Showing a lone French flag would read as a French pressing, which it is not.
  it('is all or nothing on a combination it cannot fully resolve', () => {
    expect(flagFor('France & Benelux')).toBe(null);
    expect(countryLabel('France & Benelux')).toBe('France & Benelux');
  });

  // Inventing a successor state's flag would be wrong on the sleeve in the
  // user's hand, so these deliberately get none.
  it('gives no flag to a state that no longer exists', () => {
    expect(flagFor('Yugoslavia')).toBe(null);
    expect(flagFor('Czechoslovakia')).toBe(null);
    expect(flagFor('USSR')).toBe(null);
    expect(flagFor('German Democratic Republic (GDR)')).toBe(null);
  });

  it('gives no flag where there is no country to show', () => {
    expect(flagFor('Worldwide')).toBe(null);
    expect(flagFor('Scandinavia')).toBe(null);
    expect(flagFor('Unknown')).toBe(null);
    expect(flagFor('')).toBe(null);
    expect(flagFor(null)).toBe(null);
  });

  it('returns null for anything it does not know, never a guess', () => {
    expect(flagFor('Atlantis')).toBe(null);
  });
});

describe('countryLabel', () => {
  it('prefixes the flag when there is one', () => {
    expect(countryLabel('UK')).toBe('🇬🇧 UK');
  });

  it('prints the bare name when there is not', () => {
    expect(countryLabel('Yugoslavia')).toBe('Yugoslavia');
    expect(countryLabel('Atlantis')).toBe('Atlantis');
  });

  it('is empty for no country, so a meta row does not show a stray separator', () => {
    expect(countryLabel(null)).toBe('');
    expect(countryLabel('   ')).toBe('');
  });
});

// Every distinct country string in the live collection, most common first.
// Read from the database rather than assumed: these are Discogs' own spellings.
const REAL = [
  'UK', 'Europe', 'US', 'Germany', 'UK & Europe', 'South Africa', 'Netherlands',
  'Italy', 'France', 'UK, Europe & US', 'Belgium', 'Canada', 'Sweden',
  'USA & Europe', 'Spain', 'Unknown', 'Japan', 'Portugal', 'Norway', 'Worldwide',
  'Australia', 'Poland', 'UK & Ireland', 'Czech Republic', 'EU', 'Greece',
  'Iceland', 'Singapore', 'USA & Canada', 'USA, Canada & Europe', 'Denmark',
  'France & Benelux', 'Romania', 'Scandinavia', 'South Korea', 'Switzerland',
  'Thailand', 'UK & US', 'USA, Canada & UK',
];

describe('against the countries actually in the collection', () => {
  it('never loses the country name, flag or no flag', () => {
    for (const c of REAL) expect(countryLabel(c)).toContain(c);
  });

  it('has a flag for all but the four that cannot have one', () => {
    const flagless = REAL.filter(c => !flagFor(c));
    expect(flagless.sort()).toEqual(['France & Benelux', 'Scandinavia', 'Unknown', 'Worldwide']);
  });
});
