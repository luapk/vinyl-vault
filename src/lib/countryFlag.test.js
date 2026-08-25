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
    expect(flagFor('UK & Europe')).toBe('🇪🇺');
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
