import { describe, it, expect } from 'vitest';
import { barcodeVariants } from '../discogs.js';
import { scoreCandidate } from '../scoring.js';

describe('barcodeVariants -- the same product, however it was catalogued', () => {
  it('keeps a clean EAN-13 as-is', () => {
    expect(barcodeVariants('5021392123455')).toEqual(['5021392123455']);
  });

  it('strips printed spacing and hyphens', () => {
    expect(barcodeVariants('5 021392 123455')).toEqual(['5021392123455']);
    expect(barcodeVariants('5-021392-123455')).toEqual(['5021392123455']);
  });

  it('searches a 12-digit UPC-A as EAN-13 too (the leading-zero form)', () => {
    expect(barcodeVariants('012345678905')).toEqual(['012345678905', '0012345678905']);
  });

  it('searches a zero-prefixed EAN-13 as UPC-A too', () => {
    expect(barcodeVariants('0012345678905')).toEqual(['0012345678905', '012345678905']);
  });

  it('ignores anything too short or too long to be a real barcode', () => {
    // Catalogue numbers and stray digit runs must never fire a barcode search.
    expect(barcodeVariants('1234567')).toEqual([]);
    expect(barcodeVariants('123456789012345')).toEqual([]);
    expect(barcodeVariants('WAP63')).toEqual([]);
    expect(barcodeVariants(null)).toEqual([]);
    expect(barcodeVariants(undefined)).toEqual([]);
    expect(barcodeVariants('')).toEqual([]);
  });
});

describe('scoreCandidate -- a barcode hit outranks other signals', () => {
  const vision = { artist: 'Aphex Twin', title: 'Selected Ambient Works', catalogNumber: 'AMB 3922' };

  it('beats a rival that matches the catalogue number but nothing else', () => {
    const fromBarcode = { artist: '', recordTitle: '', label: null, catalogNumber: null, viaBarcode: true };
    const catnoRival  = { artist: '', recordTitle: '', label: null, catalogNumber: 'AMB 3922' };
    expect(scoreCandidate(fromBarcode, vision)).toBeGreaterThan(scoreCandidate(catnoRival, vision));
  });

  it('adds nothing when the candidate did not come from a barcode search', () => {
    const plain = { artist: 'Aphex Twin', recordTitle: 'Selected Ambient Works', label: null };
    const same  = { ...plain, viaBarcode: true };
    expect(scoreCandidate(same, vision) - scoreCandidate(plain, vision)).toBe(8);
  });
});
