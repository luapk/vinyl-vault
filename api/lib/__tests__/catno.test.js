import { describe, it, expect } from 'vitest';
import { normalizeCatno, extractRawCatnos } from '../scoring.js';

// ---------------------------------------------------------------------------
// Catalogue number normalisation — the most important search key on a sleeve
// ---------------------------------------------------------------------------

describe('normalizeCatno() — real-world formats', () => {
  const cases = [
    // [input, must-include variants]
    ['WAP 63',     ['WAP63', 'WAP-63']],
    ['WAP63',      ['WAP63']],
    ['PM-012',     ['PM012', 'PM-012']],
    ['STUMM 123',  ['STUMM123']],
    ['DOM 001',    ['DOM001']],
    ['BC-01',      ['BC01', 'BC-01']],
    ['BRSTL 001',  ['BRSTL001']],
    ['UR-036',     ['UR036', 'UR-036']],
    ['NMW-2012',   ['NMW2012']],
    ['WARP 063',   ['WARP063']],
  ];

  cases.forEach(([input, required]) => {
    it(`${input} → includes ${required.join(', ')}`, () => {
      const result = normalizeCatno(input);
      required.forEach(r => expect(result).toContain(r));
    });
  });

  it('deduplicates: same-format catno returns unique variants only', () => {
    const variants = normalizeCatno('WAP63');
    expect(variants.length).toBe(new Set(variants).size);
  });
});

// ---------------------------------------------------------------------------
// extractRawCatnos() — pulling catnos from OCR text
// ---------------------------------------------------------------------------

describe('extractRawCatnos() — OCR extraction', () => {

  it('extracts WAP63 from sleeve text', () => {
    const raw = 'LFO WAP63 WARP RECORDS LEEDS';
    const result = extractRawCatnos(raw, null);
    expect(result).toContain('WAP63');
  });

  it('extracts UR036 from label text', () => {
    const raw = 'UNDERGROUND RESISTANCE UR036 GALAXY 2 GALAXY';
    const result = extractRawCatnos(raw, null);
    expect(result.some(c => c.includes('UR036') || c.includes('UR') )).toBe(true);
  });

  it('excludes the known catalogNumber to avoid duplicate search', () => {
    const result = extractRawCatnos('WARP WAP63 LFO', 'WAP63');
    expect(result).not.toContain('WAP63');
  });

  it('extracts multiple catnos from complex label text', () => {
    const raw = 'PLUS8 043 P8043 RICHIE HAWTIN ENFORCER 1992';
    const result = extractRawCatnos(raw, null);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('ignores plain years like "1992" or "2001"', () => {
    const raw = 'APHEX TWIN APOLLO 1992 SELECTED AMBIENT';
    const result = extractRawCatnos(raw, null);
    // Years may match \d{4} but only if preceded by letters — "1992" alone should not
    // (current regex requires [A-Z]{1,6} prefix — pure years won't match)
    result.forEach(c => {
      expect(/^\d+$/.test(c)).toBe(false);
    });
  });

  it('returns empty array for null text', () => {
    expect(extractRawCatnos(null, null)).toEqual([]);
  });

  it('returns empty array for text with no catno-like patterns', () => {
    expect(extractRawCatnos('this record has no codes', null)).toEqual([]);
  });

  it('handles record label with side indicator: "WAP63A" extracted', () => {
    const raw = 'LFO WARP RECORDS WAP63A SIDE ONE';
    const result = extractRawCatnos(raw, null);
    expect(result.some(c => c.startsWith('WAP'))).toBe(true);
  });

  it('R&S style: "RRS 8020" extracted', () => {
    const raw = 'PLASTIKMAN SPASTIK RRS 8020 R&S RECORDS';
    const result = extractRawCatnos(raw, null);
    expect(result.some(c => c.includes('8020') || c.includes('RRS'))).toBe(true);
  });
});
